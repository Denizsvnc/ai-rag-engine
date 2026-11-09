import assert from 'node:assert/strict';
import path from 'node:path';
import { env } from '@huggingface/transformers';
import { SMLEngine, LocalFaqAdapter } from '@denizsvnc/ai-rag-engine';
const previous = env.cacheDir;
env.cacheDir = path.resolve('unused-global-model-cache');
try {
    const embeddings = new SMLEngine({ cacheDir: process.env.CONSUMER_MODEL_CACHE_DIR, localFilesOnly: true });
    const vector = await embeddings.getEmbedding('Returns are accepted within 14 days.');
    assert.equal(vector.length, 384);
    assert.ok(Math.abs(Math.hypot(...vector) - 1) < 0.001);
    const faq = new LocalFaqAdapter({ smlEngine: embeddings });
    await faq.setFaqs([{ id: 'returns', question: 'What is the return window?', answer: '14 days', tenantId: 'tenant-a' }]);
    assert.equal((await faq.findBestMatch('What is the return window?', 0.8, 'tenant-a')).answer, '14 days');
    assert.equal(await faq.findBestMatch('What is the return window?', 0.8, 'tenant-b'), null);
    const isolated = new SMLEngine({ cacheDir: path.resolve('missing-instance-cache'), localFilesOnly: true });
    await assert.rejects(isolated.init());
    assert.equal(env.cacheDir, path.resolve('unused-global-model-cache'));
    console.log('PASS real local embeddings, FAQ tenant scope, per-instance cache isolation and unchanged Transformers global cache');
} finally { env.cacheDir = previous; }
