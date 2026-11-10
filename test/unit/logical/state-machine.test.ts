import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SMLEngine, CircuitBreakerOpenError } from '../../../src/core/sml-engine.js';
import { ConfirmationService } from '../../../src/core/security/confirmation.js';
import { MemoryConfirmationNonceStore } from '../../../src/core/security/nonce-store.js';

describe('Logical Verification: Finite State Machine Invariants', () => {
    describe('Circuit Breaker FSM (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)', () => {
        it('should correctly traverse all legal states and enforce failure thresholds', async () => {
            const engine = new SMLEngine({
                modelName: 'non-existent/state-machine-model',
                circuitBreakerThreshold: 2,
                circuitBreakerCooldownMs: 50 // 50ms cooldown for deterministic testing
            });

            // 1. Initial State: CLOSED
            assert.equal(engine.getCircuitState(), 'CLOSED');
            assert.equal(engine.getFailureCount(), 0);

            // 2. First Failure: Remains CLOSED, failureCount increments
            await assert.rejects(async () => {
                await engine.init();
            });
            assert.equal(engine.getCircuitState(), 'CLOSED');
            assert.equal(engine.getFailureCount(), 1);

            // 3. Second Failure: Hits threshold -> Transitions to OPEN
            await assert.rejects(async () => {
                await engine.init();
            });
            assert.equal(engine.getCircuitState(), 'OPEN');
            assert.equal(engine.getFailureCount(), 2);

            // 4. Illegal operation in OPEN: Must immediately throw CircuitBreakerOpenError without attempting network
            await assert.rejects(
                async () => {
                    await engine.init();
                },
                (err: unknown) => {
                    assert.ok(err instanceof CircuitBreakerOpenError);
                    assert.ok(err.message.includes('temporarily tripped OPEN'));
                    return true;
                }
            );

            // 5. Wait for cooldown expiration
            await new Promise(resolve => setTimeout(resolve, 60));

            // 6. Next attempt: Transitions from OPEN to HALF_OPEN to probe
            // Since model is still non-existent, probe fails -> immediately re-trips to OPEN
            await assert.rejects(async () => {
                await engine.init();
            });
            assert.equal(engine.getCircuitState(), 'OPEN', 'Failed probe in HALF_OPEN must transition back to OPEN');
        });
    });

    describe('Confirmation Ticket FSM (UNISSUED -> ISSUED -> REDEEMED -> REPLAY_BLOCKED)', () => {
        it('should strictly enforce single-use redemption and prevent unauthorized state transitions', async () => {
            const secret = 'strong_test_secret_32_bytes_long_12345';
            const nonceStore = new MemoryConfirmationNonceStore();
            const service = new ConfirmationService(secret, 60000, nonceStore);

            const toolName = 'delete_database_records';
            const tenantId = 'tenant_prod_01';
            const userId = 'user_admin';
            const args = { table: 'audit_logs', purgeBefore: '2025-01-01' };

            // 1. UNISSUED -> ISSUED
            const ticket = service.issueTicket({ toolName, args, tenantId, userId });
            assert.ok(ticket);
            assert.ok(ticket.length > 20);

            // 2. ISSUED -> REDEEMED (Valid first redemption)
            const firstVerification = await service.verifyTicket(ticket, { toolName, args, tenantId, userId });
            assert.equal(firstVerification.valid, true);

            // 3. REDEEMED -> REPLAY ATTACK REJECTED (Second redemption with identical ticket must throw)
            await assert.rejects(
                async () => {
                    await service.verifyTicket(ticket, { toolName, args, tenantId, userId });
                },
                /already been consumed|consumed|already used|Replay/
            );

            // 4. Tampering: Modified arguments transition immediately to REJECTED (throw)
            const freshTicket = service.issueTicket({ toolName, args, tenantId, userId });
            const tamperedArgs = { table: 'audit_logs', purgeBefore: '2026-01-01' }; // Changed date
            await assert.rejects(
                async () => {
                    await service.verifyTicket(freshTicket, { toolName, args: tamperedArgs, tenantId, userId });
                },
                /tamper|Hash mismatch/i
            );

            // 5. Cross-Tenant: Ticket issued for Tenant A cannot be redeemed by Tenant B
            const crossTenantTicket = service.issueTicket({ toolName, args, tenantId: 'tenant_A', userId });
            await assert.rejects(
                async () => {
                    await service.verifyTicket(crossTenantTicket, { toolName, args, tenantId: 'tenant_B', userId });
                },
                /tenant mismatch/i
            );
        });
    });
});
