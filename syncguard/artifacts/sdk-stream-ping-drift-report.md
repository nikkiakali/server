# SyncGuard Drift Report

## Executive Summary

Configuration documentation drift was detected between the runtime default and operator-facing env-example documentation. Check `gotify-stream-ping-default` against baseRef `demo-00-baseline` reports status `drift_detected`: the runtime default for `PingPeriodSeconds` changed from 45 to 60, while operator-facing configuration documentation still documents 45.

## Proven Drift

Verified runtime change (from supplied evidence):

- **Source:** `PingPeriodSeconds` in `config/config.go` (`Get`)
- **Baseline value:** 45
- **Current value:** 60

Evidence reasons:

1. Runtime default changed from 45 to 60.
2. Documented default 45 does not match current runtime default 60.

## Impact

Verified documentation mismatch (from supplied evidence):

- **Operator-facing configuration documentation:** `gotify-server.env.example`
- **Environment variable:** `GOTIFY_SERVER_STREAM_PINGPERIODSECONDS`
- **Documented default:** 45

The documented default 45 does not match the current runtime default 60. Operators relying on `gotify-server.env.example` may configure or assume a ping period that no longer matches the server’s actual default.

## Remediation Recommendation

**Proposed repair (not applied):** Update the documented default for `GOTIFY_SERVER_STREAM_PINGPERIODSECONDS` in `gotify-server.env.example` from 45 to 60 so it matches the current runtime default (`PingPeriodSeconds` = 60).

This is the smallest human-reviewable documentation repair derived from the supplied evidence. No files were inspected or edited as part of this report.

## Verification Steps

After a human applies the proposed repair:

1. Confirm `GOTIFY_SERVER_STREAM_PINGPERIODSECONDS` in `gotify-server.env.example` shows documented default 60.
2. Re-run the SyncGuard check for checkId `gotify-stream-ping-default` (recommendation: `check-sync`) and confirm status is synchronized rather than `drift_detected`.
3. Confirm the check no longer reports a mismatch between the runtime default (60) and the documented default.

## Runbook Update

Operators should record that runtime configuration defaults must stay aligned with `gotify-server.env.example` (operator-facing configuration documentation). When a runtime default such as `PingPeriodSeconds` changes, update the corresponding env-example entry (`GOTIFY_SERVER_STREAM_PINGPERIODSECONDS`) in the same change set, then re-run SyncGuard to confirm documentation and runtime remain synchronized.

## Assumptions and Confidence

**Deterministic facts (from supplied JSON only):**

- `schemaVersion`: 1  
- `checkId`: `gotify-stream-ping-default`  
- `contractKind`: `config-env-example`  
- `baseRef`: `demo-00-baseline`  
- `status`: `drift_detected`  
- Runtime: `config/config.go` / `Get` / `PingPeriodSeconds`: baseline 45 → current 60  
- Documentation: `gotify-server.env.example` / `GOTIFY_SERVER_STREAM_PINGPERIODSECONDS` / documented default 45  

**SDK interpretation / recommendations (not proven beyond the evidence):**

- That updating the env-example documented default to 60 is the correct and sufficient repair  
- That re-running SyncGuard `check-sync` is the appropriate post-repair verification command  
- Operational impact on operators who trust the env-example default  

Anything not present in the evidence (tests, other files, additional env vars, deployment behavior): unknown from supplied evidence.
