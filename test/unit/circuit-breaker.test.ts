import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SMLEngine, CircuitBreakerOpenError } from '../../src/core/sml-engine';

describe('SML Engine - Circuit Breaker Pattern', () => {
    test('should start in CLOSED healthy state', () => {
        const sml = new SMLEngine({
            circuitBreakerThreshold: 3,
            circuitBreakerCooldownMs: 1000
        });

        assert.strictEqual(sml.getCircuitState(), 'CLOSED');
        assert.strictEqual(sml.getFailureCount(), 0);
    });

    test('should trip to OPEN state when consecutive failures reach threshold', async () => {
        const sml = new SMLEngine({
            modelName: 'non-existent/model-for-failure-test',
            circuitBreakerThreshold: 2,
            circuitBreakerCooldownMs: 500
        });

        // First failure
        try {
            await sml.init();
            assert.fail('Should have failed to load non-existent model');
        } catch (err: any) {
            assert.strictEqual(sml.getFailureCount(), 1);
            assert.strictEqual(sml.getCircuitState(), 'CLOSED');
        }

        // Second failure -> reaches threshold 2 -> Trips to OPEN
        try {
            await sml.init();
            assert.fail('Should have failed second time');
        } catch (err: any) {
            assert.strictEqual(sml.getFailureCount(), 2);
            assert.strictEqual(sml.getCircuitState(), 'OPEN');
        }

        // Subsequent call immediately after must fail-fast with CircuitBreakerOpenError without downloading
        try {
            await sml.init();
            assert.fail('Should have thrown CircuitBreakerOpenError');
        } catch (err: any) {
            assert.ok(err instanceof CircuitBreakerOpenError);
            assert.ok(err.message.includes('tripped OPEN'));
        }

        // Wait for cooldown to expire (550ms > 500ms)
        await new Promise(r => setTimeout(r, 550));
        assert.strictEqual(sml.getCircuitState(), 'HALF_OPEN');

        // Reset circuit
        sml.resetCircuit();
        assert.strictEqual(sml.getCircuitState(), 'CLOSED');
    });
});
