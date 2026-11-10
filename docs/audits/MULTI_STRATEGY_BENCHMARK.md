# Multi-Strategy Architecture Benchmark

## Benchmark Results (Apple Silicon M-Series / Node.js v26.13.0)

| Benchmark Target | Category | Iterations | Throughput (ops/sec) | Avg Latency |
|---|---|---|---|---|
| `QueryPlanner.extractSignals` | CPU (Regex Stems TR/EN) | 20,000 | 1,500,281 | 0.67 µs |
| `EvidenceFusionEngine.fuse` | In-Memory (RRF + Deduplication) | 10,000 | 486,976 | 2.05 µs |
| `MemoryGraphAdapter.getNeighbors` | Graph BFS (2-hop) | 5,000 | 536,737 | 1.86 µs |

## Memory Profile
- Heap memory delta: 8.58 MB -> 11.42 MB (+2.84 MB transient garbage under load).
- Leak test: Pass. No lingering detached graph nodes or dangling timers.

