import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
const common = { bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', legalComments: 'none' };
await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' });
for (const [entry, output] of [
    ['src/api/server.ts', 'dist/api/server.js'], ['src/worker.ts', 'dist/worker.js'],
    ['src/scripts/migrate-vector.ts', 'dist/scripts/migrate-vector.js']
]) await build({ ...common, entryPoints: [entry], outfile: output, banner: { js: '#!/usr/bin/env node' } });
for (const file of ['dist/api/server.js', 'dist/worker.js', 'dist/scripts/migrate-vector.js']) await chmod(file, 0o755);
