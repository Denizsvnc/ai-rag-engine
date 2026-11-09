import assert from 'node:assert/strict';
import { readFile, access, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const { stdout } = await exec('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
const parsed = JSON.parse(stdout);
const pack = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
const files = new Set(pack.files.map(file => file.path));
assert.equal(pkg.name, '@denizsvnc/ai-rag-engine');
assert.equal(pkg.type, 'module');
assert.equal(pkg.publishConfig.access, 'public');
assert.equal(pkg.exports['.'].import, './' + pkg.main);
assert.equal(pkg.exports['.'].types, './' + pkg.types);
assert.ok(pkg.engines.node);
assert.ok(!pkg.scripts.install && !pkg.scripts.postinstall && !pkg.scripts.preinstall && !pkg.scripts.prepare, 'SDK must not execute install scripts');
for (const file of [pkg.main, pkg.types, ...Object.values(pkg.bin), 'README.md', 'LICENSE', 'CHANGELOG.md', 'docs/USAGE.md', 'docs/RELEASING.md']) assert.ok(files.has(file), 'Missing packed file: ' + file);
for (const [command, file] of Object.entries(pkg.bin)) {
    assert.ok((await readFile(path.join(root, file), 'utf8')).startsWith('#!/usr/bin/env node\n'), command + ' needs a Node shebang');
    if (process.platform !== 'win32') assert.ok((await stat(path.join(root, file))).mode & 0o111, command + ' must be executable');
}
const deps = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {}), ...Object.keys(pkg.optionalDependencies || {})]);
let relativeImports = 0;
for (const file of files) {
    assert.ok(file === 'package.json' || /^(?:README\.md|LICENSE|CHANGELOG\.md|docs\/(?:USAGE|RELEASING)\.md|dist\/.+(?:\.js|\.d\.ts))$/.test(file), 'Unexpected packed file: ' + file);
    assert.ok(!/(?:^|\/)(?:examples?|test|data|node_modules|\.env)(?:\/|\.)|\.map$|\.log$/.test(file), 'Unsafe/unnecessary packed file: ' + file);
    const source = await readFile(path.join(root, file), 'utf8');
    assert.ok(!/\/Users\/|\/private\/var\/folders\/|[A-Z]:\\Users\\/.test(source), 'Development-machine path in ' + file);
    assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|npm_[A-Za-z0-9]{30,}/.test(source), 'Possible credential in ' + file);
    assert.ok(!/sourceMappingURL=/.test(source), 'Unresolvable source map in ' + file);
    if (!file.startsWith('dist/')) continue;
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (specifier.startsWith('.')) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
            const declaration = file.endsWith('.d.ts') ? target.replace(/\.js$/, '.d.ts') : target;
            assert.ok(files.has(declaration), `Unresolved import in ${file}: ${specifier}`); relativeImports++;
            await access(path.join(root, declaration));
        } else if (!specifier.startsWith('node:')) {
            const base = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
            // Node builtins can appear without node: in existing adapters.
            const { isBuiltin } = await import('node:module');
            assert.ok(isBuiltin(specifier) || deps.has(base), `Undeclared runtime/type dependency in ${file}: ${base}`);
        }
    }
}
const result = { name: pack.name, version: pack.version, packedBytes: pack.size, unpackedBytes: pack.unpackedSize, fileCount: files.size, relativeImports, files: [...files].sort() };
if (process.env.PACK_REPORT_PATH) await writeFile(process.env.PACK_REPORT_PATH, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
