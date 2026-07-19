# SyncGuard Drift Report

## Executive Summary

The targeted documentation drift for checkId `gotify-pagination-default` against baseRef `demo-00-baseline` is resolved: overall status is `synchronized`. Affected operations `getAppMessages` (`GET /application/{id}/message`) and `getMessages` (`GET /message`) are synchronized; no unresolved drift remains for those operations in the supplied evidence.

## Proven Drift

**Historical runtime change** (from `runtimeChange`):

| Field | Value |
| --- | --- |
| Source | `api/message.go`, symbol `withPaging`, field `Limit` |
| Baseline value | `100` (line 122) |
| Current value | `50` (line 122) |

**Per-operation alignment** (all status `synchronized`):

- **`getAppMessages`** — `GET /application/{id}/message`: `runtimeDefault` = `50`, `annotationDefault` = `50`, `generatedSpecDefault` = `50` (match).
- **`getMessages`** — `GET /message`: `runtimeDefault` = `50`, `annotationDefault` = `50`, `generatedSpecDefault` = `50` (match).

Scope is limited to these two operations. Annotation and generated-spec defaults are not stale relative to runtime for the listed operations.

## Impact

For API consumers of `GET /application/{id}/message` and `GET /message`, pagination behavior is defined by the runtime default for `Limit`. Keeping `runtimeDefault`, `annotationDefault`, and `generatedSpecDefault` aligned at `50` means clients and tools that rely on swagger annotations or the generated OpenAPI spec see the same default page size the server applies. Misalignment would cause incorrect client assumptions about how many messages are returned when `limit` is omitted. Impact outside these two operations is unknown from supplied evidence.

## Remediation Recommendation

No further remediation is required for this synchronized check. Do not update swagger annotations, regenerate the spec, or change runtime for `getAppMessages` or `getMessages` based on this evidence.

**Maintenance (recommendation only):** After any future change to the runtime `Limit` default in `withPaging`, re-verify that annotations and the generated spec still match before treating the check as closed.

## Verification Steps

1. Re-run SyncGuard `detect-drift` (or the equivalent check for `gotify-pagination-default`) against the same baseRef (or the current baseline used by the pipeline).
2. Confirm the check reports status `synchronized` and that both `getAppMessages` and `getMessages` still show matching `runtimeDefault`, `annotationDefault`, and `generatedSpecDefault` of `50`.
3. Do not run remediation steps for this check while evidence shows synchronized status.

## Runbook Update

Ops should record for this drift class (`gotify-pagination-default`):

- **Verified synchronization:** runtime default for `withPaging`/`Limit` is `50`; swagger annotation defaults and generated-spec defaults for `getAppMessages` and `getMessages` also `50`; check status `synchronized` vs baseRef `demo-00-baseline`.
- **Triplet to track:** runtime default ↔ swagger annotations ↔ generated OpenAPI spec.
- **Forward rule:** any future runtime change to the pagination `Limit` default requires re-checking that annotations and generated spec remain aligned before closing the drift class again.

## Assumptions and Confidence

**Deterministic facts from the evidence:**

- `schemaVersion` = `1`, `checkId` = `gotify-pagination-default`, `baseRef` = `demo-00-baseline`, overall `status` = `synchronized`.
- Runtime change: `api/message.go` / `withPaging` / `Limit`: baseline `100` → current `50` (both at line 122).
- Both listed operations have `runtimeDefault`, `annotationDefault`, and `generatedSpecDefault` equal to `50` and status `synchronized`.

**SDK interpretation / assumptions (not proven by the evidence):**

- That re-running detect-drift will remain green without further code changes.
- That ongoing maintenance after future runtime edits is sufficient process control.
- That consumer impact is limited to incorrect default page-size assumptions (inferred from the nature of the aligned fields).

**Explicitly not claimed:**

- That every pagination-related test or repository reference was checked or synchronized.
- Verification of `api/message_test.go` or any file other than `api/message.go` as named in `runtimeChange` — those are unknown from supplied evidence.
- Numeric defaults, endpoints, or operations beyond those in the evidence.
