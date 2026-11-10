import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SMLEngine } from '../../src/core/sml-engine.js';
import { env } from '@huggingface/transformers';

describe('SML Engine - Concurrent Initialization & Global Env Isolation', () => {
    it('should safely serialize concurrent init() calls across independent instances with distinct cache directories', async () => {
        const baseModels = path.resolve('data/models/Xenova');
        const tmpDirs: string[] = [];

        try {
            // Create 5 distinct cache directories symlinking the cached model weights
            for (let i = 0; i < 5; i++) {
                const dir = path.resolve(`tmp/test_models_tenant_${i}`);
                fs.mkdirSync(dir, { recursive: true });
                const destLink = path.join(dir, 'Xenova');
                if (!fs.existsSync(destLink) && fs.existsSync(baseModels)) {
                    fs.symlinkSync(baseModels, destLink);
                }
                tmpDirs.push(dir);
            }

            const originalEnvCache = env.cacheDir;
            const originalAllowRemote = env.allowRemoteModels;

            // Instantiate 5 engines with distinct cache directories and alternating localFilesOnly settings
            const engines = tmpDirs.map((dir, idx) => new SMLEngine({
                modelName: 'Xenova/all-MiniLM-L6-v2',
                dtype: 'q8',
                cacheDir: dir,
                localFilesOnly: idx % 2 === 0
            }));

            // Trigger init() on all instances concurrently
            const extractors = await Promise.all(engines.map(engine => engine.init()));

            assert.equal(extractors.length, 5);
            for (const extractor of extractors) {
                assert.equal(typeof extractor, 'function');
            }

            // Assert that the mutable global env was restored and not poisoned
            assert.equal(env.cacheDir, originalEnvCache, 'Global env.cacheDir must be restored after initialization');
            assert.equal(env.allowRemoteModels, originalAllowRemote, 'Global env.allowRemoteModels must be restored after initialization');

            // Parallel inference execution across all distinct engines
            const embeddings = await Promise.all(
                engines.map((engine, idx) => engine.getEmbedding(`Concurrent test text ${idx}`))
            );

            assert.equal(embeddings.length, 5);
            for (const emb of embeddings) {
                assert.equal(emb.length, 384);
            }
        } finally {
            // Clean up temporary symlink directories
            for (const dir of tmpDirs) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
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

    it('should prove cache isolation: empty directory with localFilesOnly fails and does not inherit models from parallel instance', async () => {
        const emptyDir = path.resolve('tmp/test_empty_cache_isolation');
        fs.mkdirSync(emptyDir, { recursive: true });

        try {
            const isolatedEngineWithoutModels = new SMLEngine({
                modelName: 'Xenova/all-MiniLM-L6-v2',
                dtype: 'q8',
                cacheDir: emptyDir,
                localFilesOnly: true,
                circuitBreakerThreshold: 1
            });

            const validEngineWithModels = new SMLEngine({
                modelName: 'Xenova/all-MiniLM-L6-v2',
                dtype: 'q8',
                cacheDir: path.resolve('data/models'),
                localFilesOnly: true
            });

            // Run concurrently: valid engine must succeed, empty dir engine must fail
            // If cache settings or env leaked, the empty dir engine would erroneously succeed
            const [isolatedResult, validResult] = await Promise.allSettled([
                isolatedEngineWithoutModels.init(),
                validEngineWithModels.init()
            ]);

            assert.equal(
                isolatedResult.status,
                'rejected',
                'Engine with empty cacheDir and localFilesOnly: true must fail to load models'
            );
            assert.equal(
                validResult.status,
                'fulfilled',
                'Engine with valid cacheDir must succeed in parallel'
            );
        } finally {
            fs.rmSync(emptyDir, { recursive: true, force: true });
        }
    });
});
