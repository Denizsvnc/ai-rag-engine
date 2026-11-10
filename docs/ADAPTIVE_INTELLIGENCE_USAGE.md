# Adaptive Multi-Strategy Intelligence Guide

## Installation & Setup

```typescript
import { RAGEngine, MemoryGraphAdapter, PostgresGraphAdapter } from '@denizsvnc/ai-rag-engine';

const graph = new MemoryGraphAdapter();

const engine = new RAGEngine({
    inputs: {
        graph,
        vectorStore: myVectorStore,
        rules: myRulesAdapter
    },
    llmProvider: myLLMProvider,
    adaptive: {
        enabled: true,
        mode: 'auto', // 'auto' | 'manual' | 'auto-hybrid' | 'fallback'
        maxParallelOperations: 3,
        latencyDeadlineMs: 4000,
        fusion: {
            reciprocalRankK: 60,
            detectContradictions: true,
            maxContextTokens: 3000
        }
    }
});

await engine.init();
```

## Querying with Adaptive Intelligence

```typescript
// Auto mode: automatically routes to graph_rag, kag, agentic_rag, or hybrid_search
const response = await engine.query('CEO ile direktörler arasındaki ilişki zinciri nedir?', {
    tenantId: 'org_enterprise'
});

console.log(response.answer);
console.log('Strategy Decision:', response.strategyDecision);
console.log('Fused Evidence:', response.evidence);
```

## Manual Mode & Overrides

```typescript
// Explicitly force a specific strategy per query
const response = await engine.query('Yıllık izin şartları nelerdir?', {
    tenantId: 'org_enterprise',
    adaptiveOverrides: {
        mode: 'manual',
        strategy: 'kag'
    }
});
```

