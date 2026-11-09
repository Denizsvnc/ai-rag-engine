import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { LocalFaqAdapter } from '../../src/adapters/faq/local-faq.adapter.js';
import { SMLEngine } from '../../src/core/sml-engine.js';
import { ToolRegistry } from '../../src/core/tool-registry.js';
import { CacheManager } from '../../src/core/cache-manager.js';

test('default FAQ never loads a consumer repository src file implicitly', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'rag-faq-default-'));
    const cwd = process.cwd();
    try {
        await mkdir(path.join(directory, 'src/utils'), { recursive: true });
        await writeFile(path.join(directory, 'src/utils/faq-embeddings.json'), JSON.stringify([{ id: 'wrong', question: 'wrong', answer: 'untrusted implicit data', embedding: [1] }]));
        process.chdir(directory);
        assert.deepEqual(await new LocalFaqAdapter().getFaqs(), []);
    } finally { process.chdir(cwd); await rm(directory, { recursive: true, force: true }); }
});

test('persisted response cache is private to its OS user and can be reloaded', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'rag-cache-mode-'));
    try {
        const file = path.join(directory, 'cache.json');
        const cache = new CacheManager(file, 2);
        await cache.set('key', { answer: 'private answer' });
        await cache.get('key');
        if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
        const restored = new CacheManager(file, 2); await restored.init();
        assert.deepEqual(await restored.get('key'), { answer: 'private answer' });
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('new tool registry persists usable routing metadata with private POSIX permissions', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'rag-registry-mode-'));
    try {
        const file = path.join(directory, 'registry.json');
        const sml = new SMLEngine();
        sml.getEmbedding = async () => new Float32Array([1, 0]);
        const registry = new ToolRegistry(sml, file);
        await registry.initialize([{ name: 'lookup', description: 'Look up a value', async execute() { return 'value'; } }]);
        if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
        assert.equal((await registry.routeQueryToTool('a value'))?.name, 'lookup');
    } finally { await rm(directory, { recursive: true, force: true }); }
});
