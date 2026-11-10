import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SMLEngine } from '../../src/core/sml-engine.js';

describe('SML Engine - Concurrent Initialization & Global Env Isolation', () => {
    it('should safely serialize concurrent init() calls across independent SMLEngine instances', async () => {
        // Create 10 independent SMLEngine instances
        const engines = Array.from({ length: 10 }, () => new SMLEngine({
            modelName: 'Xenova/all-MiniLM-L6-v2',
            dtype: 'q8',
            cacheDir: './data/models'
        }));

        // Trigger init() on all 10 instances simultaneously
        const extractors = await Promise.all(engines.map(engine => engine.init()));

        assert.equal(extractors.length, 10);
        for (const extractor of extractors) {
            assert.equal(typeof extractor, 'function');
        }

        // Parallel inference execution across all 10 engines
        const embeddings = await Promise.all(
            engines.map((engine, idx) => engine.getEmbedding(`Concurrent test text ${idx}`))
        );

        assert.equal(embeddings.length, 10);
        for (const emb of embeddings) {
            assert.equal(emb.length, 384);
        }
    });

    it('should correctly handle failed initialization without poisoning next in line', async () => {
        const failingEngine = new SMLEngine({
            modelName: 'non-existent/bad-model-id',
            circuitBreakerThreshold: 1,
            circuitBreakerCooldownMs: 100
        });

        const healthyEngine = new SMLEngine({
            modelName: 'Xenova/all-MiniLM-L6-v2',
            dtype: 'q8',
            cacheDir: './data/models'
        });

        // Run both concurrently
        const [failResult, healthyResult] = await Promise.allSettled([
            failingEngine.init(),
            healthyEngine.init()
        ]);

        assert.equal(failResult.status, 'rejected');
        assert.equal(healthyResult.status, 'fulfilled');

        // Healthy engine produces valid embeddings despite prior failure in queue
        const emb = await healthyEngine.getEmbedding('resiliency verification');
        assert.equal(emb.length, 384);
    });
});

