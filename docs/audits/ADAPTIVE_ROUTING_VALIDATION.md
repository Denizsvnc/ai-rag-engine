# ADAPTIVE ROUTING & POLICY ENFORCEMENT AUDIT REPORT

**Date:** 2026-11-11  
**Remediation Phase:** Phase 7 (P1 — Adaptive Query Routing & Policy Enforcement)  
**Target:** `src/core/adaptive/query-planner.ts`  
**Status:** FIXED AND INDEPENDENTLY VERIFIED  

---

## 1. Executive Summary

In AI-RAG-ENGINE v2.4.0 baseline, `AdaptiveQueryPlanner` allowed untrusted callers to bypass tenant and system security policies via `context.metadata.requestedStrategy` and `requestedMode`. If an enterprise disabled `agentic_rag` to prevent mutating tool execution, a caller could override the planner into manual mode. Additionally, heuristic confidence scores were hardcoded to a static 0.90, failing to signal degraded or fallback retrieval confidence to downstream consumers.

This defect has been remediated:
1. `allowRequestOverrides`: When false, request-level overrides are strictly rejected and logged in decision reasons.
2. Tenant & Policy Enforcement: Even when overrides are enabled, requesting a strategy disabled by system/tenant config is rejected, logged in `rejectedStrategies`, and safely redirected to an authorized fallback.
3. Signal-Calibrated Confidence: Heuristic scores reflect genuine signal matches (0.95 for exact ID, 0.92 for action, 0.90 for formal logic, 0.88 for multi-hop graph, down to 0.60/0.70 for generic fallbacks, and 0.0 on empty sets).

---

## 2. Root Cause Analysis

```typescript
// VULNERABLE BASELINE (v2.4.0)
const mode = (context.metadata?.requestedMode) || this.config.mode || 'auto';
// No check for this.config.allowRequestOverrides!
// In manual mode:
const requested = context.metadata?.requestedStrategy;
if (requested && availableIds.has(requested)) {
    selectedStrategies.push(requested); // EXECUTED EVEN IF DISABLED BY TENANT POLICY!
}
```

---

## 3. Remediation Architecture

1. **Policy Gate on Overrides**:
   `const allowOverrides = this.config.allowRequestOverrides !== false;`
   If false, `requestedMode` and `requestedStrategy` are ignored entirely.
2. **Permission Check**:
   `this.registry.isStrategyPermitted(requestedStrategy)` must return true. If false, entry is added to `rejectedStrategies` with explicit security violation explanation.
3. **Calibrated Confidence**:
   Mapped directly to signal strength and strategy suitability.

---

## 4. Verification Evidence

**Suite:** `test/unit/adaptive/query-planner-policy.test.ts` (3/3 PASS)

| Test Case | Scenario | Expected Behavior | Result |
| :--- | :--- | :--- | :--- |
| **Override Suppression** | `allowRequestOverrides: false` | Caller `manual` mode ignored; stays `auto` | PASS |
| **Disabled Strategy Rejection** | Caller requests disabled `agentic_rag` | Strategy rejected, recorded in `rejectedStrategies`, falls back safely | PASS |
| **Confidence Calibration** | Exact ID vs Logic vs Fallback | Confidence yields 0.95, 0.90, 0.70 respectively | PASS |

---

## 5. Status

**FIXED AND INDEPENDENTLY VERIFIED**

