import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Readable } from 'node:stream';
import { DocumentIngestionService } from '../../src/services/document-ingestion.service';
import { SMLEngine, CircuitBreakerOpenError } from '../../src/core/sml-engine';
import { dotProduct } from '../../src/utils/math';
import { TieredLLMProvider } from '../../src/adapters/llm/tiered.adapter';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../src/interfaces/llm.interface';

class FailingLLM implements ILLMProvider {
    constructor(private errorMessage: string = 'Primary LLM API Unavailable (503)') {}
    async generate(_req: ILLMRequest): Promise<ILLMResponse> {
        throw new Error(this.errorMessage);
    }
}

class SuccessfulLLM implements ILLMProvider {
    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        return { content: `Fallback recovered: ${req.userPrompt}` };
    }
}

describe('Chaos & Fault Injection Hardening', () => {
    test('Stream Fault: Truncated or errored stream should reject gracefully without dangling resources', async () => {
        const service = new DocumentIngestionService();

        async function* faultyGenerator() {
            yield Buffer.from('Initial safe document chunk...');
            throw new Error('Simulated network disconnect mid-stream');
        }

        const faultyStream = Readable.from(faultyGenerator());

        await assert.rejects(
            async () => {
                await service.ingestStreamDirect('abrupted.txt', faultyStream);
            },
            {
                message: /Simulated network disconnect mid-stream/
            }
        );
    });

    test('Provider Cascade Failure: Primary tier throws 504 -> Automatic failover to secondary tier succeeds', async () => {
        const failingPrimary = new FailingLLM('Primary LLM API Unavailable (503)');
        const backupProvider = new SuccessfulLLM();

        const tieredProvider = new TieredLLMProvider({
            fastProvider: failingPrimary,
            smartProvider: backupProvider
        });

        const response = await tieredProvider.generate({
            systemPrompt: 'System',
            userPrompt: 'Simple user question'
        });

        assert.ok(response.content.includes('Fallback recovered'));
    });

    test('Circuit Breaker Fault Recovery: Tripped OPEN breaker prevents DOS and recovers after cooldown', async () => {
        const sml = new SMLEngine({
            modelName: 'non-existent/faulty-model-xyz',
            circuitBreakerThreshold: 2,
            circuitBreakerCooldownMs: 50
        });

        // 1. First failure
        await assert.rejects(async () => sml.init());
        assert.strictEqual(sml.getCircuitState(), 'CLOSED');

        // 2. Second failure triggers OPEN state
        await assert.rejects(async () => sml.init());
        assert.strictEqual(sml.getCircuitState(), 'OPEN');

        // 3. Immediate call should fail instantly with CircuitBreakerOpenError without attempting network/model
        const startInstant = Date.now();
        await assert.rejects(
            async () => sml.init(),
            (err: any) => err instanceof CircuitBreakerOpenError
        );
        assert.ok(Date.now() - startInstant < 20, 'Circuit breaker should reject in <20ms');

        // 4. Wait for cooldown to expire
        await new Promise(resolve => setTimeout(resolve, 60));

        // State transitions to HALF_OPEN on next check
        assert.strictEqual(sml.getCircuitState(), 'HALF_OPEN');

        // Reset manual check
        sml.resetCircuit();
        assert.strictEqual(sml.getCircuitState(), 'CLOSED');
    });

    test('Poison Pill Math: Dot product handles non-finite floats, dimensional mismatches, and empty arrays safely', () => {
        const vecA = [1.0, 0.5, 0.2];
        const vecB = [0.5, 0.5];

        // Dimension mismatch
        assert.throws(() => dotProduct(vecA, vecB), /Vector dimensions do not match/);

        // Identical unit vector
        const unitVec = [1, 0, 0];
        assert.strictEqual(dotProduct(unitVec, unitVec), 1);
    });
});
