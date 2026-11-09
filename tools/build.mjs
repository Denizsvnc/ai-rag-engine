import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const common = { bundle: true, platform: 'node', format: 'esm', packages: 'external' };
await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' });
for (const [entry, output] of [
    ['src/api/server.ts', 'dist/api/server.js'], ['src/worker.ts', 'dist/worker.js'],
    ['src/scripts/migrate-vector.ts', 'dist/scripts/migrate-vector.js']
]) await build({ ...common, entryPoints: [entry], outfile: output, banner: { js: '#!/usr/bin/env node' } });
await mkdir('dist/assets', { recursive: true });
await copyFile('src/utils/faq-embeddings.json', 'dist/assets/faq-embeddings.json');
