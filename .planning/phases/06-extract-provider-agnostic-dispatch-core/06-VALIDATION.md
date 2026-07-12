---
phase: 6
slug: extract-provider-agnostic-dispatch-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-12
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| **Framework**          | jest (ts-jest)                                                               |
| **Config file**        | `jest.config.js` (existing)                                                  |
| **Quick run command**  | `yarn test`                                                                  |
| **Full suite command** | `yarn test` (server, 511 tests) + `cd github-action && yarn test` (13 tests) |
| **Estimated runtime**  | ~15s server, ~3s github-action                                               |

---

## Sampling Rate

- **After every task commit:** Run `yarn test`
- **After every plan wave:** Run `yarn test` (full server suite)
- **Before `/gsd:verify-work`:** Full suite must be green (server + github-action)
- **Max feedback latency:** ~20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior              | Test Type | Automated Command                                           | File Exists | Status     |
| ------- | ---- | ---- | ----------- | ---------- | ---------------------------- | --------- | ----------------------------------------------------------- | ----------- | ---------- |
| 6-01-01 | 01   | 1    | PROV-01     | —          | N/A (pure refactor, no IO)   | unit      | `yarn test src/services/dispatch/deployStatus.test.ts`      | ❌ W0       | ⬜ pending |
| 6-02-01 | 02   | 1    | PROV-02     | —          | N/A (pure function, no IO)   | unit      | `yarn test src/services/dispatch/planDispatch.test.ts`      | ❌ W0       | ⬜ pending |
| 6-03-01 | 03   | 2    | PROV-02     | —          | Same workflow_dispatch fires | unit      | `yarn test src/services/build/buildDispatchService.test.ts` | ✅          | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `src/services/dispatch/deployStatus.test.ts` — tests for PROV-01 (outcome→status, legal transitions), no mocks
- [ ] `src/services/dispatch/planDispatch.test.ts` — tests for PROV-02 (DispatchPlan / ValidationError, no IO), no mocks

_Existing jest infrastructure covers all phase requirements — no framework install needed._

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
| -------- | ----------- | ---------- | ----------------- |
| —        | —           | —          | —                 |

_All phase behaviors have automated verification (pure functions + existing characterization test at `buildDispatchService.test.ts`)._

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
