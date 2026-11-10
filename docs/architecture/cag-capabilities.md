# Cache-Augmented Generation (CAG) Capabilities

## 1. Capability Spectrum

Cache-Augmented Generation spans multiple technical tiers. The SDK provides honest reporting of capability levels:

```
[Level 1: Exact Response Cache] -> [Level 2: Semantic Response Cache] -> [Level 3: Prompt-Prefix Cache] -> [Level 4: Provider KV-Cache]
```

1. **Level 1: Exact Response Cache**:
   - Stores completed LLM outputs keyed by HMAC-SHA256 of `(prompt + tenantId + roles)`.
   - Backed by `MemoryCache` or `RedisCacheAdapter`.
   - Latency: < 1ms.

2. **Level 2: Semantic Response Cache**:
   - In-memory vector similarity match using local ONNX embeddings (`cosine >= 0.96`).
   - Serves paraphrased queries without invoking external LLMs.

3. **Level 3: Prompt-Prefix Caching**:
   - Formats system instructions, active enterprise rules, and static FAQs into fixed prefixes.
   - Preserves prefix alignments for backends that reuse prompt key-value representations.

4. **Level 4: Native Model KV-Cache Reuse**:
   - Honest capability declaration: Native model KV-cache preservation requires runtime support from inference engines (e.g., vLLM chunked prefill, llama.cpp context shift, Anthropic prompt caching headers).
   - In standard stateless HTTP endpoints, the SDK operates at Level 1-3 and marks `kvCachePreserved: false` unless a compatible provider adapter is mounted.

