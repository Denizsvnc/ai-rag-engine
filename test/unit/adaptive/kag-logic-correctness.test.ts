import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KAGStrategy } from '../../../src/core/adaptive/strategies/kag.strategy.js';
import { MemoryGraphAdapter } from '../../../src/adapters/graph/memory-graph.adapter.js';
import type { IRulesAdapter } from '../../../src/interfaces/rules.interface.js';

describe('KAG Logical Deduction & Truth Preservation (Phase 6)', () => {
    it('rejects pseudo-deduction based solely on superficial keyword overlap', async () => {
        const mockRules: IRulesAdapter = {
            getActiveRules: async () => [
                'Eğer müşteri VIP statüsünde ise kargo ücreti alınmaz.'
            ]
        };
        const graph = new MemoryGraphAdapter();
        const kag = new KAGStrategy(mockRules, graph, undefined, true);

        // Query only contains "ücreti", but does not ground the antecedent (VIP status)
        const res = await kag.execute({
            query: 'Kargo ücreti nedir?',
            tenantId: 'tenant-1'
        });

        assert.equal(res.success, true);
        const deductions = (res.intermediateData?.['deductions'] as any[]) || [];
        assert.ok(deductions.length > 0);

        // Must NOT be marked as derived because antecedent was not verified!
        const derived = deductions.filter(d => d.status === 'derived');
        assert.equal(derived.length, 0);

        // Rule should remain asserted
        const asserted = deductions.find(d => d.status === 'asserted');
        assert.ok(asserted);
    });

    it('derives conclusion when verified graph fact grounds the rule', async () => {
        const mockRules: IRulesAdapter = {
            getActiveRules: async () => [
                'Sunucu acil_bakim modunda olduğunda dış erişim durdurulur.'
            ]
        };
        const graph = new MemoryGraphAdapter();
        await graph.addNodes([
            { id: 'Sunucu-1', name: 'Sunucu-1', type: 'server', tenantId: 'tenant-1', confidence: 1.0 },
            { id: 'acil_bakim', name: 'acil_bakim', type: 'status', tenantId: 'tenant-1', confidence: 1.0 }
        ]);
        await graph.addEdges([{
            id: 'edge-1',
            sourceId: 'Sunucu-1',
            targetId: 'acil_bakim',
            relation: 'durumundadır',
            category: 'extracted',
            weight: 1.0,
            tenantId: 'tenant-1',
            confidence: 0.99
        }]);

        const kag = new KAGStrategy(mockRules, graph, undefined, true);
        const res = await kag.execute({
            query: 'Sunucu-1 erişimi açık mı?',
            tenantId: 'tenant-1'
        });

        assert.ok((res.intermediateData?.['verifiedFactsCount'] as number) > 0);
        assert.equal(res.success, true);
        const deductions = (res.intermediateData?.['deductions'] as any[]) || [];
        const derived = deductions.find(d => d.status === 'derived');
        assert.ok(derived);
        assert.equal(derived.status, 'derived');
        assert.ok(derived.groundingFactIds.includes('edge-1'));
        assert.ok(res.confidence >= 0.90);
    });

    it('derives conclusion when conditional IF...THEN antecedent is verified', async () => {
        const mockRules: IRulesAdapter = {
            getActiveRules: async () => [
                'Eğer sipariş tutarı 500TL üzerinde ise hediye kupon verilir.'
            ]
        };
        const graph = new MemoryGraphAdapter();
        const kag = new KAGStrategy(mockRules, graph, undefined, true);

        const res = await kag.execute({
            query: 'Müşteri sipariş tutarı 500TL üzerinde, ne yapılmalı?',
            tenantId: 'tenant-1'
        });

        assert.equal(res.success, true);
        const deductions = (res.intermediateData?.['deductions'] as any[]) || [];
        const derived = deductions.find(d => d.status === 'derived');
        assert.ok(derived);
        assert.ok(derived.conclusion.includes('hediye kupon verilir'));
    });

    it('detects policy contradiction when affirmative action violates prohibition rule', async () => {
        const mockRules: IRulesAdapter = {
            getActiveRules: async () => [
                'Veri tabanı root parolası paylaşımı kesinlikle yasaktır.'
            ]
        };
        const graph = new MemoryGraphAdapter();
        const kag = new KAGStrategy(mockRules, graph, undefined, true);

        const res = await kag.execute({
            query: 'Root parolası için izin verildi ve onaylandı, paylaşabilir miyim?',
            tenantId: 'tenant-1'
        });

        assert.equal(res.success, true);
        const deductions = (res.intermediateData?.['deductions'] as any[]) || [];
        const contradiction = deductions.find(d => d.status === 'contradiction');
        assert.ok(contradiction);
        assert.equal(contradiction.status, 'contradiction');
    });

    it('abstains with 0.0 confidence when no rules or graph facts exist', async () => {
        const mockEmptyRules: IRulesAdapter = {
            getActiveRules: async () => []
        };
        const graph = new MemoryGraphAdapter();
        const kag = new KAGStrategy(mockEmptyRules, graph, undefined, true);

        const res = await kag.execute({
            query: 'Bilinmeyen konu hakkında soru',
            tenantId: 'tenant-1'
        });

        assert.equal(res.success, true);
        assert.equal(res.evidence.length, 0);
        assert.equal(res.confidence, 0.0);
    });
});
