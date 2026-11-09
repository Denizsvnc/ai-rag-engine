import { mkdtemp, copyFile, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.env.PG_TEST_URL || !process.env.REDIS_TEST_URL) throw new Error('PG_TEST_URL and REDIS_TEST_URL must point to disposable test services.');
const project = process.env.CONSUMER_PROJECT || await mkdtemp(path.join(process.env.CONSUMER_PROJECT_ROOT || tmpdir(), 'rag-consumer-'));
if (process.env.CONSUMER_PROJECT && JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')).name !== 'rag-customer-verification') throw new Error('Reuse requires an existing disposable verification project.');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cache = process.env.CONSUMER_NPM_CACHE || path.join(tmpdir(), 'rag-npm-cache');
const installFlags = process.env.CONSUMER_BIN_LINKS === 'false' ? ['--bin-links=false'] : [];
console.log(`Consumer project: ${project}`);
await exec(npm, ['pack', '--pack-destination', project], { cwd: root, maxBuffer: 5 * 1024 * 1024 });
const tarball = path.join(project, `${metadata.name.replace('@', '').replace('/', '-')}-${metadata.version}.tgz`);
await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'rag-customer-verification', version: '1.0.0', private: true, type: 'module' }, null, 2));
await copyFile(new URL('./customer.mjs', import.meta.url), path.join(project, 'customer.mjs'));
await writeFile(path.join(project, 'types.ts'), `import { RAGEngine, PostgresVectorAdapter, QueuedIngestionService, IngestionWorker, type IIngestionBackend, type EngineMetricsSummary } from '${metadata.name}';
const store = new PostgresVectorAdapter({ connectionString: 'postgresql://example.invalid/test' });
const engine = new RAGEngine({ inputs: { vectorStore: store }, llmProvider: { async generate() { return { content: 'typed' }; } } });
const factory: typeof IngestionWorker = IngestionWorker;
const service: typeof QueuedIngestionService = QueuedIngestionService;
const metrics: EngineMetricsSummary = engine.getMetrics();
const backend: IIngestionBackend | undefined = undefined;
void [factory, service, metrics, backend];
`);
await writeFile(path.join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, skipLibCheck: false, noEmit: true }, include: ['types.ts'] }, null, 2));
if (process.env.CONSUMER_SEED_MODULES) {
    // APFS copies have independent paths/inodes and share only unchanged disk blocks.
    // npm still resolves, installs the SDK tarball, and prunes extraneous packages.
    await exec('cp', ['-cR', process.env.CONSUMER_SEED_MODULES, path.join(project, 'node_modules')]);
    console.log('Dependency files seeded with APFS copy-on-write to conserve disk space.');
}
console.log('Installing the packed SDK without repository devDependencies...');
await exec(npm, ['install', '--omit=dev', ...installFlags, '--cache', cache, tarball], { cwd: project, maxBuffer: 5 * 1024 * 1024 });
await exec(npm, ['install', '--save-dev', '--save-exact', ...installFlags, '--cache', cache, `typescript@${metadata.devDependencies.typescript}`], { cwd: project, maxBuffer: 5 * 1024 * 1024 });
try {
    await exec(process.execPath, [path.join(project, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], { cwd: project, maxBuffer: 5 * 1024 * 1024 });
} catch (error) {
    await writeFile(path.join(project, 'typecheck.log'), error.stdout + error.stderr);
    console.error(error.stdout); throw error;
}
for (const file of ['index.js', 'api/server.js', 'worker.js', 'scripts/migrate-vector.js']) {
    const built = await readFile(path.join(root, 'dist', file));
    const installed = await readFile(path.join(project, 'node_modules', metadata.name, 'dist', file));
    if (!built.equals(installed)) throw new Error('Installed package differs from current build: ' + file);
}
console.log('Strict NodeNext consumer typecheck and installed artifact parity passed.');
const child = execFile(process.execPath, ['customer.mjs'], { cwd: project, env: {
    ...process.env,
    RAG_MODEL_CACHE_DIR: process.env.RAG_MODEL_CACHE_DIR || path.join(root, 'data/models')
}, maxBuffer: 10 * 1024 * 1024 });
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Consumer tests exited ${code}; project: ${project}`))); });
console.log(`Consumer verification complete: ${project}/verification.json`);
