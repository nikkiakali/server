# SyncGuard Drift Report

## Executive Summary

Documentation drift was detected by checkId `gotify-pagination-default` against baseRef `demo-00-baseline`. The runtime default page limit for message listing changed from 100 to 50, while swagger annotations and the generated spec still document 100 for the affected operations.

## Proven Drift

**Runtime change (authoritative):**

| Field | Value |
| --- | --- |
| Source | `api/message.go` → symbol `withPaging` → field `Limit` |
| Baseline value | 100 |
| Current value | 50 |
| Baseline line | 122 |
| Current line | 122 |
| Overall status | `drift_detected` |

**Affected operations:**

1. **`getAppMessages`** — `GET /application/{id}/message`
   - `runtimeDefault`: 50
   - `annotationDefault`: 100
   - `generatedSpecDefault`: 100
   - `status`: `drift_detected`

2. **`getMessages`** — `GET /message`
   - `runtimeDefault`: 50
   - `annotationDefault`: 100
   - `generatedSpecDefault`: 100
   - `status`: `drift_detected`

## Impact

API consumers and docs that rely on the annotation or generated OpenAPI defaults will expect a default `Limit` of 100 for `GET /message` and `GET /application/{id}/message`, but the server currently defaults to 50. Clients that omit an explicit limit may receive fewer messages per page than documented, which can break pagination assumptions, incomplete-fetch logic, and any code generated or validated against the stale spec defaults.

## Remediation Recommendation

**Recommendation (not a proven fact):** Align documentation with the current runtime default of 50, unless product intent is known to reverse the runtime change.

Evidence shows runtime `Limit` is 50 while annotations and generated-spec defaults remain 100. Whether the runtime change was intentional is **unknown from supplied evidence**. The safer remediation when intent is unclear is:

1. Update swagger/OpenAPI annotations for `getMessages` and `getAppMessages` so the documented default `Limit` is 50 (matching `withPaging` in `api/message.go`).
2. Regenerate the OpenAPI/spec artifact so `generatedSpecDefault` becomes 50 for those operations.
3. Do **not** change runtime back to 100 solely to match docs without confirming product intent — that intent is **unknown from supplied evidence**.

## Verification Steps

**Recommendation:** after remediating, a human should:

1. Confirm runtime default for `withPaging` / `Limit` in `api/message.go` is still the intended value (currently 50 per evidence).
2. Confirm annotation defaults for `getMessages` and `getAppMessages` match that runtime value.
3. Regenerate the API spec (exact command **unknown from supplied evidence**) and confirm `generatedSpecDefault` is 50 for both operations.
4. Re-run SyncGuard detect-drift for checkId `gotify-pagination-default` against the appropriate base ref and confirm status is no longer `drift_detected`.

## Runbook Update

Add guidance for this drift class:

- **Runtime default vs swagger annotations vs generated spec** must stay in sync for pagination `Limit` (and similar query defaults).
- When SyncGuard reports `drift_detected` on pagination defaults, treat the runtime source (`api/message.go` / `withPaging` / `Limit`) as the behavior clients actually get; treat stale `annotationDefault` / `generatedSpecDefault` as a documentation bug until intentionally reconciled.
- Ops should require: (1) decide whether runtime or docs is canonical for the change, (2) update annotations, (3) regenerate the spec, (4) re-run SyncGuard detect-drift for `gotify-pagination-default` before merging.

## Assumptions and Confidence

**Deterministic facts from the evidence:**

- `checkId` is `gotify-pagination-default`; `baseRef` is `demo-00-baseline`; `status` is `drift_detected`.
- Runtime `Limit` in `api/message.go` (`withPaging`) changed from 100 to 50 at line 122.
- Both `getAppMessages` (`GET /application/{id}/message`) and `getMessages` (`GET /message`) show `runtimeDefault` 50 vs `annotationDefault` 100 and `generatedSpecDefault` 100.

**SDK interpretation / assumptions (not proven by the evidence):**

- That the runtime change was intentional (or not) — **unknown from supplied evidence**.
- That aligning docs to 50 is the preferred product outcome — recommendation only.
- Exact regenerate-spec / detect-drift CLI invocations and repo layout beyond cited paths — **unknown from supplied evidence** where not listed above.
