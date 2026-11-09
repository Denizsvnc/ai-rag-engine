import { mkdtemp, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const project = await mkdtemp(path.join(process.env.CONSUMER_PROJECT_ROOT || tmpdir(), 'rag-package-consumer-'));
const cache = process.env.CONSUMER_NPM_CACHE || path.join(tmpdir(), 'rag-release-cache');
console.log('Independent consumer: ' + project);
await exec('npm', ['pack', '--pack-destination', project], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
const tarball = (await readdir(project)).find(name => name.endsWith('.tgz'));
await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'rag-package-consumer', version: '1.0.0', private: true, type: 'module' }, null, 2));
if (process.env.CONSUMER_SEED_MODULES) await exec('cp', ['-cR', process.env.CONSUMER_SEED_MODULES, path.join(project, 'node_modules')]);
await exec('npm', ['install', '--omit=dev', '--cache', cache, './' + tarball], { cwd: project, maxBuffer: 5 * 1024 * 1024 });
for (const file of ['consumer.mjs', 'no-model-loader.mjs', 'types.ts', 'embedding.mjs']) await copyFile(new URL(file, import.meta.url), path.join(project, file));
// If .env is loaded as an import side effect, the subprocess environment check will fail.
await writeFile(path.join(project, '.env'), 'SDK_IMPORT_SIDE_EFFECT_SENTINEL=must-not-load\n');
const env = { ...process.env, NODE_ENV: 'production' };
for (const name of ['JWT_SECRET', 'CONFIRMATION_SECRET', 'DATABASE_URL', 'REDIS_URL', 'SDK_IMPORT_SIDE_EFFECT_SENTINEL']) delete env[name];
if ((await readdir(path.join(project, 'node_modules'))).some(name => ['typescript', 'tsx', 'ts-node'].includes(name))) throw new Error('Runtime fixture unexpectedly contains TypeScript build tools.');
for (const file of ['index.js', 'api/server.js', 'worker.js', 'scripts/migrate-vector.js']) {
    const installed = await readFile(path.join(project, 'node_modules', metadata.name, 'dist', file));
    if (!installed.equals(await readFile(path.join(root, 'dist', file)))) throw new Error('Installed artifact differs from build: ' + file);
}
const nodeBinaries = process.env.CONSUMER_NODE_BINARIES ? process.env.CONSUMER_NODE_BINARIES.split(path.delimiter) : [process.execPath];
const results = [];
for (const node of nodeBinaries) {
    const version = (await exec(node, ['--version'])).stdout.trim();
    const { stdout } = await exec(node, ['consumer.mjs'], { cwd: project, env, maxBuffer: 5 * 1024 * 1024 });
    console.log(version + ': ' + stdout.trim());
    if (process.env.CONSUMER_MODEL_CACHE_DIR) {
        const embedded = await exec(node, ['embedding.mjs'], { cwd: project, env, maxBuffer: 5 * 1024 * 1024 });
        console.log(version + ': ' + embedded.stdout.trim());
    }
    results.push({ node: version, passed: true, realEmbedding: Boolean(process.env.CONSUMER_MODEL_CACHE_DIR) });
}
// Both the minimum recommended TypeScript and the repository compiler must work.
const compilers = [metadata.devDependencies.typescript, '5.8.3'];
for (const compiler of compilers) {
    await exec('npm', ['install', '--save-dev', '--save-exact', '--cache', cache, 'typescript@' + compiler], { cwd: project, maxBuffer: 5 * 1024 * 1024 });
    for (const resolution of ['NodeNext', 'Bundler']) {
        const config = { compilerOptions: { target: 'ES2022', module: resolution === 'Bundler' ? 'ESNext' : 'NodeNext', moduleResolution: resolution, strict: true, skipLibCheck: false, noEmit: true }, include: ['types.ts'] };
        await writeFile(path.join(project, 'tsconfig.json'), JSON.stringify(config, null, 2));
        await exec(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { cwd: project, maxBuffer: 5 * 1024 * 1024 });
    }
}
const readme = await readFile(path.join(project, 'node_modules', metadata.name, 'README.md'), 'utf8');
const quickStart = readme.match(/```js\n([\s\S]*?)```/)[1];
await writeFile(path.join(project, 'quick-start.mjs'), quickStart);
const quick = await exec(process.execPath, ['quick-start.mjs'], { cwd: project, env, maxBuffer: 5 * 1024 * 1024 });
if (!quick.stdout.includes('Returns: 14 days.')) throw new Error('README Quick Start did not produce its documented answer.');
const fixture = await exec(process.execPath, [path.join(root, 'tools/verify-package.mjs')], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
const packageReport = JSON.parse(fixture.stdout);
await writeFile(path.join(project, 'verification.json'), JSON.stringify({ success: true, package: metadata.name, version: metadata.version, results, typecheck: ['NodeNext strict', 'Bundler strict'], compilers, dependencySeed: Boolean(process.env.CONSUMER_SEED_MODULES), packageReport }, null, 2));
console.log('PASS strict TypeScript consumers; verification: ' + path.join(project, 'verification.json'));
