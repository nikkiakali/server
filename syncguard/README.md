# SyncGuard

Gotify’s message-listing API applies a runtime default for pagination that can change independently of what Swagger annotations and the generated OpenAPI spec document. SyncGuard keeps three layers aligned for that OpenAPI check:

1. **Runtime implementation** — the default applied when a client omits the `limit` query parameter.
2. **Authoritative Swagger annotations** — go-swagger `swagger:operation` godoc comments in Go source.
3. **Generated OpenAPI specification** — `docs/spec.json`, produced by Gotify’s canonical generator.

SyncGuard also validates a second contract: a runtime configuration default against operator-facing environment documentation in `gotify-server.env.example`.

When runtime behavior changes, the relevant documentation layer must be updated (and, for OpenAPI, regenerated), or documentation drift persists even though the server runs correctly.

## Architecture

SyncGuard separates deterministic enforcement from explanatory analysis:

| Layer | Role | Decides CI pass/fail? | Edits files? |
|-------|------|----------------------|--------------|
| Deterministic detector (`detect-drift`, `check-sync`) | Parses runtime source and documentation inputs; compares numeric defaults against a Git baseline; writes structured evidence JSON | **Yes** (`check-sync` in CI) | No |
| Cursor SDK analyzer (`sdk-analyze`) | Reads deterministic evidence; produces a human-readable Markdown report grounded in proven facts | **No** | No |
| Gotify Swagger generator (`make update-swagger`) | Regenerates `docs/spec.json` from authoritative annotations (OpenAPI check only) | No | Yes (generated spec only) |

**OpenAPI pagination flow:**

```
Runtime code (api/message.go)
        ↓
Deterministic evidence (JSON)
        ↓
CI pass/fail (check-sync)
        ↓
SDK explanation (Markdown report)
        ↓
Human approval
        ↓
Authoritative annotation remediation (swagger:operation godoc)
        ↓
Canonical spec regeneration (make update-swagger)
        ↓
Deterministic closure proof (check-sync again)
        ↓
SDK closure report (optional)
```

**Configuration env-example flow:**

```
Runtime config default (config/config.go)
        ↓
Deterministic evidence (JSON)
        ↓
CI pass/fail (check-sync)
        ↓
SDK explanation (Markdown report)
        ↓
Human approval
        ↓
Operator-facing env-example edit (gotify-server.env.example)
        ↓
Deterministic closure proof (check-sync again)
        ↓
SDK synchronization closure report (optional)
```

Architectural boundaries:

- **Deterministic code alone** decides synchronization status and CI exit codes.
- The **Cursor SDK explains only** already-proven deterministic evidence; it does not independently inspect repository files or decide whether drift exists.
- The **SDK does not edit files**.
- **CI never invokes the SDK** and requires no Cursor API key.
- **Human approval is required** before remediation.
- **Canonical documentation sources and generators remain authoritative** (`swagger:operation` godoc + `make update-swagger` for OpenAPI; direct edits to `gotify-server.env.example` for the configuration check).

## What SyncGuard currently checks

SyncGuard implements **two explicitly declared checks** — not a universal plugin framework and not automatic discovery of arbitrary contracts or documentation formats. Adding another contract shape would require a new declaration in `checkDefinition.ts`, parser/comparison logic, and tests.

Both checks depend on a valid Git baseline (default `demo-00-baseline`) and full history (`fetch-depth: 0` in CI).

### 1. `gotify-pagination-default`

| Item | Value |
|------|-------|
| Contract shape | Runtime API default ↔ Swagger annotations ↔ generated OpenAPI |
| Runtime source | `api/message.go`, function `withPaging`, field `Limit` in a `pagingParams` composite literal |
| Baseline runtime | `100` (from `--base-ref`) |
| Current runtime | `50` |
| Query parameter | `limit` |
| Generated spec | `docs/spec.json` |
| Endpoints | `GET /message` (`getMessages`), `GET /application/{id}/message` (`getAppMessages`) |
| Evidence artifact | `syncguard/artifacts/deterministic-evidence.json` |
| Default SDK report | `syncguard/artifacts/sdk-drift-report.md` |

**Evidence shape (OpenAPI-operation — no explicit `contractKind` field):**

- `runtimeChange` (baseline vs current)
- `affectedOperations[]` with `operationId`, `method`, `path`, `runtimeDefault`, `annotationDefault`, `generatedSpecDefault`, and per-operation `status`

The detector compares the **current** runtime default against Swagger annotation defaults and generated-spec defaults for those two operations. It also reads the **baseline** runtime default from a Git ref (`--base-ref`) to detect whether runtime changed since the baseline.

If baseline runtime equals current runtime, status is `no_relevant_change` (pass). If runtime changed and both annotation and generated-spec defaults match the new runtime, status is `synchronized` (pass). If runtime changed and either documentation layer is stale, status is `drift_detected` (fail in CI).

**Canonical OpenAPI remediation:**

1. Update Swagger annotations in `api/message.go`.
2. Run `make update-swagger` from the repository root.
3. Verify with `make check-swagger`.

Do not hand-edit `docs/spec.json`; annotations are authoritative and direct spec edits are overwritten on regeneration.

This check does not validate every API field, response schema, or unrelated operation.

### 2. `gotify-stream-ping-default`

| Item | Value |
|------|-------|
| Contract kind | `config-env-example` |
| Contract shape | Runtime configuration default ↔ operator-facing environment documentation |
| Runtime source | `config/config.go`, symbol `Get`, field `PingPeriodSeconds` (`Server.Stream.PingPeriodSeconds`) |
| Baseline runtime | `45` |
| Current runtime | `60` |
| Documentation source | `gotify-server.env.example`, `GOTIFY_SERVER_STREAM_PINGPERIODSECONDS` (documented default `60`) |
| Evidence artifact | `syncguard/artifacts/deterministic-evidence-stream-ping.json` |
| Historical SDK drift report | `syncguard/artifacts/sdk-stream-ping-drift-report.md` (preserved audit artifact) |
| SDK closure report | `syncguard/artifacts/sdk-stream-ping-closure-report.md` (title `# SyncGuard Synchronization Closure Report`) |

**Evidence shape (`config-env-example`):**

- `contractKind: "config-env-example"`
- `runtimeChange` (baseline vs current)
- `documentation.file`, `documentation.envVariable`, `documentation.documentedDefault`
- `reasons[]`
- **No** Swagger, OpenAPI operation, `affectedOperations`, `annotationDefault`, or `generatedSpecDefault` fields

The OpenAPI remediation process (`make update-swagger`) does **not** apply to this check. `gotify-server.env.example` is edited directly because it has no equivalent Swagger-style generator.

**Audit artifacts:** `sdk-stream-ping-drift-report.md` is a preserved historical audit artifact documenting the previously detected mismatch and proposed repair. The current deterministic stream-ping evidence is **synchronized** — do **not** use it to regenerate or overwrite the historical drift report.

## Commands

Run all commands from the `syncguard/` directory after `npm ci`.

### `npm run typecheck`

Type-checks SyncGuard TypeScript with `tsc --noEmit`. No arguments.

### `npm test`

Runs focused unit tests for parsing, comparison, detection, check-sync, and SDK analysis helpers:

```bash
npm test
```

No arguments. Current result: **117 tests**, **21 suites**, **0 failures**.

### `npm run detect-drift`

Runs the deterministic detector for **pagination only** (`gotify-pagination-default`). Writes pagination evidence JSON and prints a summary. **Does not run the stream-ping check.** **Does not fail on drift unless `--fail-on-drift` is passed.**

```bash
npm run detect-drift -- --base-ref <git-ref> [--output <path>] [--fail-on-drift]
```

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--base-ref` | Yes | — | Git ref for baseline runtime (e.g. `demo-00-baseline`) |
| `--output` | No | `syncguard/artifacts/deterministic-evidence.json` | Evidence output path (relative paths resolve from repository root) |
| `--fail-on-drift` | No | off | Exit non-zero on proven drift (same per-check exit codes as `check-sync`) |

Exit codes without `--fail-on-drift`: `0` for `synchronized`, `no_relevant_change`, or `drift_detected`; `1` for `inconclusive` or runtime errors.

### `npm run check-sync`

**Multi-check deterministic CI gate.** Runs **both** explicit checks, writes **both** evidence artifacts, and aggregates exit codes. Never invokes the Cursor SDK.

```bash
npm run check-sync -- [--base-ref <git-ref>] [--output <path>]
```

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--base-ref` | No | `demo-00-baseline` | Git ref for baseline runtime |
| `--output` | No | `syncguard/artifacts/deterministic-evidence.json` | Pagination evidence output path only |

Stream-ping evidence is always written to `syncguard/artifacts/deterministic-evidence-stream-ping.json` (declared in the check definition).

Example stdout (both checks synchronized):

```text
gotify-pagination-default: synchronized
...
gotify-stream-ping-default: synchronized
runtime PingPeriodSeconds: baseline=45 current=60
GOTIFY_SERVER_STREAM_PINGPERIODSECONDS: documented=60
...
aggregate: pass (exit=0)
```

**Aggregate exit precedence** (when both checks run):

| Condition | Exit code |
|-----------|-----------|
| Any inconclusive status or execution error | **1** |
| Otherwise, any `drift_detected` | **2** |
| Otherwise (`synchronized` and/or `no_relevant_change`) | **0** |

An inconclusive result in **one** check takes precedence over proven drift in the **other** check (aggregate exit **1**, not **2**).

Per-check status exit codes (used by `detect-drift --fail-on-drift` for pagination alone):

| Status | Exit code |
|--------|-----------|
| `synchronized` | 0 |
| `no_relevant_change` | 0 |
| `drift_detected` | 2 |
| `inconclusive` | 1 |
| Parse/runtime error | 1 |

### `npm run sdk-analyze`

Runs a local Cursor SDK agent in plan mode. Reads deterministic evidence, streams a Markdown report, validates required headings, and writes the report file. Requires `CURSOR_API_KEY` and Node ≥ 22.13. **Not run in CI.**

```bash
export CURSOR_API_KEY=cursor_...   # not required for CI

npm run sdk-analyze -- [--input <path>] [--output <path>]
```

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--input` | No | `artifacts/deterministic-evidence.json` | Evidence JSON (paths relative to `syncguard/`) |
| `--output` | No | `artifacts/sdk-drift-report.md` | Report output path |

Accepts evidence with status `drift_detected` (open-drift analysis) or `synchronized` (closure report). Rejects `no_relevant_change` and `inconclusive`.

**Pagination (default paths):**

```bash
npm run sdk-analyze
# reads artifacts/deterministic-evidence.json
# writes artifacts/sdk-drift-report.md
# title: # SyncGuard Drift Report
```

**Stream ping (explicit paths — use separate output files):**

```bash
# Drift analysis (only when evidence status is drift_detected):
npm run sdk-analyze -- \
  --input artifacts/deterministic-evidence-stream-ping.json \
  --output artifacts/sdk-stream-ping-drift-report.md

# Synchronization closure (only when evidence status is synchronized):
npm run sdk-analyze -- \
  --input artifacts/deterministic-evidence-stream-ping.json \
  --output artifacts/sdk-stream-ping-closure-report.md
# title: # SyncGuard Synchronization Closure Report
```

Do not regenerate the historical stream-ping drift report from current synchronized evidence.

## End-to-end workflow

### Workflow A: OpenAPI pagination (`gotify-pagination-default`)

#### 1. Detect drift

From `syncguard/`:

```bash
npm run detect-drift -- --base-ref demo-00-baseline
```

Or use the CI-equivalent gate (runs both checks):

```bash
npm run check-sync
```

#### 2. Examine deterministic evidence

```bash
cat artifacts/deterministic-evidence.json
```

Evidence fields include `status`, `runtimeChange` (baseline vs current), and per-endpoint `annotationDefault`, `generatedSpecDefault`, and `runtimeDefault`.

#### 3. Generate an SDK drift report (optional, local only)

After drift is detected and evidence is written:

```bash
export CURSOR_API_KEY=cursor_...
npm run sdk-analyze
```

Output: `artifacts/sdk-drift-report.md`.

#### 4. Correct authoritative Swagger annotations

Edit the go-swagger `swagger:operation` godoc comments in `api/message.go`. Update the `default:` value for the `limit` query parameter on both affected operations so it matches the intentional runtime default in `withPaging`.

#### 5. Regenerate the OpenAPI specification

From the **repository root**:

```bash
make update-swagger
make check-swagger
```

Commit the updated `docs/spec.json` with the annotation changes.

#### 6. Prove synchronization

From `syncguard/`:

```bash
npm run check-sync
```

Expect aggregate exit `0` and `gotify-pagination-default: synchronized`.

#### 7. Generate a closure report (optional)

Re-run SDK analysis on synchronized pagination evidence:

```bash
npm run sdk-analyze
```

The report switches to post-remediation closure mode when evidence status is `synchronized`.

### Workflow B: Configuration env-example (`gotify-stream-ping-default`)

#### 1. Detect drift

From `syncguard/`:

```bash
npm run check-sync
```

Expect `gotify-stream-ping-default: drift_detected` and aggregate exit **2** when the env example is stale.

#### 2. Examine deterministic evidence

```bash
cat artifacts/deterministic-evidence-stream-ping.json
```

#### 3. Generate an SDK drift report (optional, local only)

Only when evidence status is `drift_detected`:

```bash
export CURSOR_API_KEY=cursor_...
npm run sdk-analyze -- \
  --input artifacts/deterministic-evidence-stream-ping.json \
  --output artifacts/sdk-stream-ping-drift-report.md
```

#### 4. Human-approved remediation

Edit `gotify-server.env.example` so `GOTIFY_SERVER_STREAM_PINGPERIODSECONDS` documents the current runtime default. Do **not** use `make update-swagger` for this check.

#### 5. Prove synchronization

```bash
npm run check-sync
```

Expect `gotify-stream-ping-default: synchronized` and aggregate exit **0**.

#### 6. Generate a synchronization closure report (optional)

Only when evidence status is `synchronized`:

```bash
npm run sdk-analyze -- \
  --input artifacts/deterministic-evidence-stream-ping.json \
  --output artifacts/sdk-stream-ping-closure-report.md
```

## Stream-ping red-to-green proof (committed branch history)

The `demo/pagination-doc-remediation` branch includes a committed lifecycle demonstrating deterministic enforcement and SDK explanation **without** SDK authority over CI. This is **branch-history proof** — not a required destructive or restore-based local walkthrough.

1. Runtime default `PingPeriodSeconds` changed from **45** to **60** in `config/config.go`.
2. `gotify-server.env.example` temporarily remained **45**.
3. Deterministic status became **`drift_detected`** for `gotify-stream-ping-default`.
4. `npm run check-sync` exited **2**.
5. The GitHub SyncGuard workflow **failed intentionally**.
6. The Cursor SDK generated a grounded explanation from deterministic evidence (`sdk-stream-ping-drift-report.md`).
7. The SDK did **not** decide synchronization status and did **not** edit files.
8. A human approved the narrow environment-documentation repair.
9. The documented value changed from **45** to **60**.
10. Deterministic status became **`synchronized`**.
11. `check-sync` exited **0**.
12. Later SyncGuard and Gotify build workflows became green.
13. **`gotify-pagination-default` remained synchronized throughout.**

## CI behavior

Workflow: `.github/workflows/syncguard.yml`

Triggers on push and pull_request when paths change under:

- `api/**`
- `docs/spec.json`
- `config/**`
- `gotify-server.env.example`
- `syncguard/**`
- `.github/workflows/syncguard.yml`

Job steps (Node **22**, `fetch-depth: 0` for Git baseline access):

1. `npm ci`
2. `npm run typecheck`
3. `npm test` (117 tests, 21 suites)
4. `npm run check-sync`

Within the SyncGuard workflow, `check-sync` is the sole documentation-sync pass/fail authority. No `CURSOR_API_KEY` is configured and no SDK commands run in CI.

| Aggregate outcome | Exit code |
|-------------------|-----------|
| Both checks pass (synchronized and/or no_relevant_change) | 0 |
| Any proven drift (and no inconclusive) | 2 |
| Any inconclusive comparison or job error | 1 |

## Evidence and reports

All artifacts live under `syncguard/artifacts/`:

| File | Producer | Type | Overwritten on re-run? |
|------|----------|------|------------------------|
| `deterministic-evidence.json` | `detect-drift`, `check-sync` (pagination) | Deterministic, machine-readable | Yes |
| `deterministic-evidence-stream-ping.json` | `check-sync` (stream ping) | Deterministic, machine-readable | Yes |
| `sdk-drift-report.md` | `sdk-analyze` (pagination default paths) | SDK-generated, human-readable | Yes (default path) |
| `sdk-stream-ping-drift-report.md` | `sdk-analyze` (explicit stream-ping drift paths) | SDK audit artifact | Preserve; do not overwrite from synchronized evidence |
| `sdk-stream-ping-closure-report.md` | `sdk-analyze` (explicit stream-ping closure paths) | SDK synchronization closure report | Written separately from drift report |

**Deterministic evidence** is the source of truth for what drift exists. It contains only parsed values and derived status — no LLM judgment.

**SDK reports** explain proven drift or confirmed synchronization for humans. They must not contradict the evidence JSON. The SDK validates required Markdown headings before writing the file.

Running `detect-drift` or `check-sync` overwrites the corresponding deterministic evidence JSON files. Use explicit `--input` / `--output` with `sdk-analyze` to avoid clobbering audit artifacts.

## Behavioral tests

SyncGuard’s own tests (`npm test`) validate parsing, comparison, and check aggregation. They do **not** replace Gotify’s broader behavioral test suite.

When runtime contracts change, update the relevant Gotify tests independently:

| Check | Gotify behavioral coverage |
|-------|---------------------------|
| Pagination default | Exercised through `Limit: 50` expectations in `api/message_test.go`. There is **no** separately named focused pagination-default test. |
| Stream ping default | `TestStreamPingPeriodSecondsDefault` in `config/config_test.go` (asserts `PingPeriodSeconds` default is **60**) |

Deterministic synchronization success in SyncGuard does **not** by itself prove the entire Gotify project passes every test. A complete change should pass both the **SyncGuard workflow** (`.github/workflows/syncguard.yml`) and the **Gotify build workflow** (`.github/workflows/build.yml`).

## Demo walkthrough

### Pagination ephemeral demo (local, restore-based)

A 3–5 minute interview demo that runs entirely on your **current synchronized branch**. Do not commit the temporary drift edits — discard them when finished.

Local Git tags (`demo-00-baseline`, `demo-01-drift`, `demo-02-sdk-analysis`, `demo-03-synchronized`) mark development milestones during SyncGuard construction. Only `demo-00-baseline` is confirmed on the GitHub remote; the later tags predate Phase 4A and do not include `npm run check-sync`. They are not used as runnable demo checkpoints.

**Prerequisites:** Node ≥ 22.13, `npm ci` in `syncguard/`, and `CURSOR_API_KEY` exported for SDK steps.

Begin only with a **clean working tree** — cleanup uses `git restore`:

```bash
git status --short
# (no output — proceed; otherwise commit or stash unrelated changes first)
```

#### 1. Confirm synchronized starting point

From `syncguard/`:

```bash
cd syncguard
npm run check-sync
# aggregate: pass (exit=0); both checks synchronized
```

#### 2. Introduce temporary documentation drift

In `api/message.go`, change the `default:` value for the `limit` query parameter from `50` to `100` in **both** swagger blocks (`getMessages` and `getAppMessages`). Leave the runtime default in `withPaging` at `Limit: 50`.

Regenerate the spec so both documentation layers are stale (runtime `50`, annotations `100`, generated spec `100`):

From the **Gotify repository root**:

```bash
cd ..   # if currently in syncguard/
make update-swagger
```

From `syncguard/`:

```bash
cd syncguard
npm run check-sync
# gotify-pagination-default: drift_detected; aggregate: fail (exit=2)
```

#### 3. Examine evidence and generate an SDK drift report

Still in `syncguard/`:

```bash
cat artifacts/deterministic-evidence.json

export CURSOR_API_KEY=cursor_...
npm run sdk-analyze
# read artifacts/sdk-drift-report.md
```

#### 4. Remediate annotations and regenerate the spec

In `api/message.go`, restore both `limit` annotation defaults to `50`.

From the **Gotify repository root**:

```bash
cd ..   # if currently in syncguard/
make update-swagger
make check-swagger
```

#### 5. Prove closure and generate the SDK closure report

From `syncguard/`:

```bash
cd syncguard
npm run check-sync
# aggregate: pass (exit=0)

npm run sdk-analyze
# closure report in artifacts/sdk-drift-report.md
```

#### 6. Restore a clean working tree

From the repository root:

```bash
cd ..
git diff --check
git restore api/message.go docs/spec.json
git diff --check
```

This discards the temporary annotation edits and regenerated spec from the demo. Artifact files under `syncguard/artifacts/` may still differ from HEAD; restore them too if needed (`git restore syncguard/artifacts/`).

### Stream-ping lifecycle demo (read-only, branch history)

Inspect the committed synchronized state and preserved audit artifacts on `demo/pagination-doc-remediation`. **Do not** regenerate the historical drift report from current synchronized evidence.

From `syncguard/`:

```bash
cat artifacts/deterministic-evidence-stream-ping.json
cat artifacts/sdk-stream-ping-drift-report.md
cat artifacts/sdk-stream-ping-closure-report.md
npm run check-sync
# gotify-stream-ping-default: synchronized
# aggregate: pass (exit=0)
```

Refer to [Stream-ping red-to-green proof](#stream-ping-red-to-green-proof-committed-branch-history) for the full committed lifecycle narrative.

## Scope and limitations

- **Two declared checks** — SyncGuard currently implements `gotify-pagination-default` and `gotify-stream-ping-default`. It is broader than one hardcoded pagination example, but it is **not** a universal plugin framework and does **not** automatically discover arbitrary contracts or documentation formats.
- **Adding a third check** requires a new declaration, parser/comparison logic, and tests — not configuration alone.
- **Command scope split** — `detect-drift` is pagination-only; `check-sync` is the multi-check CI gate that runs both checks and writes both evidence artifacts.
- **Baseline dependency** — Both checks require a valid Git ref accessible via `git show <base-ref>:<path>`. The default baseline is the local tag `demo-00-baseline` (also on the GitHub remote). Shallow clones without that ref will fail or produce inconclusive results. CI uses `fetch-depth: 0`.
- **SDK is local and optional** — `sdk-analyze` requires `CURSOR_API_KEY`, network access, and Node ≥ 22.13. CI does not run it.
- **Deterministic comparison is authoritative** — An LLM never decides whether values match. The SDK explains evidence; `check-sync` enforces it.
- **OpenAPI remediation** — Fix swagger godoc comments, then regenerate with `make update-swagger` and verify with `make check-swagger`. Do not hand-edit `docs/spec.json`.
- **Configuration remediation** — Edit `gotify-server.env.example` directly; there is no Swagger-style generator for operator env documentation.
- **Aggregate inconclusive precedence** — Any inconclusive check forces aggregate exit **1**, even if another check has proven drift.
- **Behavioral test independence** — SyncGuard synchronization does not replace Gotify’s full test suite (`build.yml`).
- **Historical demo tags** — Local tags `demo-01-drift`, `demo-02-sdk-analysis`, and `demo-03-synchronized` record intermediate milestones but are not required (or suitable) for running demos; use the branch-local walkthroughs above instead.
