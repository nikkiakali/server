# SyncGuard

Gotify’s message-listing API applies a runtime default for pagination that can change independently of what Swagger annotations and the generated OpenAPI spec document. SyncGuard keeps three layers aligned:

1. **Runtime implementation** — the default applied when a client omits the `limit` query parameter.
2. **Authoritative Swagger annotations** — go-swagger `swagger:operation` godoc comments in Go source.
3. **Generated OpenAPI specification** — `docs/spec.json`, produced by Gotify’s canonical generator.

When runtime behavior changes, annotations and the generated spec must be updated and regenerated, or documentation drift persists even though the server runs correctly.

## Architecture

SyncGuard separates deterministic enforcement from explanatory analysis:

| Layer | Role | Decides CI pass/fail? | Edits files? |
|-------|------|----------------------|--------------|
| Deterministic detector (`detect-drift`, `check-sync`) | Parses runtime source, annotations, and `docs/spec.json`; compares numeric defaults against a Git baseline; writes structured evidence JSON | **Yes** (`check-sync` in CI) | No |
| Cursor SDK analyzer (`sdk-analyze`) | Reads deterministic evidence; produces a human-readable Markdown report grounded in proven facts | **No** | No |
| Gotify Swagger generator (`make update-swagger`) | Regenerates `docs/spec.json` from authoritative annotations | No | Yes (generated spec only) |

```
Runtime code (api/message.go)
        ↓
Deterministic evidence (JSON)
        ↓
CI pass/fail (check-sync)
        ↓
SDK explanation (Markdown report)
        ↓
Authoritative annotation remediation (swagger:operation godoc)
        ↓
Canonical spec regeneration (make update-swagger)
        ↓
Deterministic closure proof (check-sync again)
        ↓
SDK closure report (optional)
```

The Cursor SDK never decides CI status and never modifies repository files. Only deterministic code determines whether values match.

## What SyncGuard currently checks

SyncGuard implements one check: **`gotify-pagination-default`**.

| Item | Value |
|------|-------|
| Runtime source | `api/message.go`, function `withPaging`, field `Limit` in a `pagingParams` composite literal |
| Query parameter | `limit` |
| Generated spec | `docs/spec.json` |
| Endpoints | `GET /message` (`getMessages`), `GET /application/{id}/message` (`getAppMessages`) |

The detector compares the **current** runtime default against Swagger annotation defaults and generated-spec defaults for those two operations. It also reads the **baseline** runtime default from a Git ref (`--base-ref`) to detect whether runtime changed since the baseline.

If baseline runtime equals current runtime, status is `no_relevant_change` (pass). If runtime changed and both annotation and generated-spec defaults match the new runtime, status is `synchronized` (pass). If runtime changed and either documentation layer is stale, status is `drift_detected` (fail in CI).

This prototype intentionally covers only the pagination default for these two endpoints. It does not validate every API field, response schema, or unrelated operation.

## Commands

Run all commands from the `syncguard/` directory after `npm ci`.

### `npm run typecheck`

Type-checks SyncGuard TypeScript with `tsc --noEmit`. No arguments.

### `npm test`

Runs focused unit tests for parsing, comparison, detection, check-sync, and SDK analysis helpers:

```bash
npm test
```

No arguments.

### `npm run detect-drift`

Runs the deterministic detector for local exploration. Writes evidence JSON and prints a summary. **Does not fail on drift unless `--fail-on-drift` is passed.**

```bash
npm run detect-drift -- --base-ref <git-ref> [--output <path>] [--fail-on-drift]
```

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--base-ref` | Yes | — | Git ref for baseline runtime (e.g. `demo-00-baseline`) |
| `--output` | No | `syncguard/artifacts/deterministic-evidence.json` | Evidence output path (relative paths resolve from repository root) |
| `--fail-on-drift` | No | off | Exit non-zero on proven drift (same exit codes as `check-sync`) |

Exit codes without `--fail-on-drift`: `0` for `synchronized`, `no_relevant_change`, or `drift_detected`; `1` for `inconclusive` or runtime errors.

### `npm run check-sync`

CI gate. Thin wrapper around the same detector with `failOnDrift` always enabled. Never invokes the Cursor SDK.

```bash
npm run check-sync -- [--base-ref <git-ref>] [--output <path>]
```

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--base-ref` | No | `demo-00-baseline` | Git ref for baseline runtime |
| `--output` | No | `syncguard/artifacts/deterministic-evidence.json` | Evidence output path |

Exit codes:

| Status | Exit code |
|--------|-----------|
| `synchronized` | 0 |
| `no_relevant_change` | 0 |
| `drift_detected` | 2 |
| `inconclusive` | 1 |
| Parse/runtime error | 1 |

### `npm run sdk-analyze`

Runs a local Cursor SDK agent in plan mode. Reads deterministic evidence, streams a Markdown report, validates required headings, and writes the report file. Requires `CURSOR_API_KEY` and Node ≥ 22.13.

```bash
export CURSOR_API_KEY=cursor_...   # not required for CI

npm run sdk-analyze -- [--input <path>] [--output <path>]
```

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--input` | No | `artifacts/deterministic-evidence.json` | Evidence JSON (paths relative to `syncguard/`) |
| `--output` | No | `artifacts/sdk-drift-report.md` | Report output path |

Accepts evidence with status `drift_detected` (open-drift analysis) or `synchronized` (closure report). Rejects `no_relevant_change` and `inconclusive`.

## End-to-end workflow

### 1. Detect drift

From `syncguard/`:

```bash
npm run detect-drift -- --base-ref demo-00-baseline
```

Or use the CI-equivalent gate:

```bash
npm run check-sync
```

### 2. Examine deterministic evidence

Inspect the summary printed to stdout, or read the JSON artifact:

```bash
cat artifacts/deterministic-evidence.json
```

Evidence fields include `status`, `runtimeChange` (baseline vs current), and per-endpoint `annotationDefault`, `generatedSpecDefault`, and `runtimeDefault`.

### 3. Generate an SDK drift report (optional, local only)

After drift is detected and evidence is written:

```bash
export CURSOR_API_KEY=cursor_...
npm run sdk-analyze
```

Output: `artifacts/sdk-drift-report.md`.

### 4. Correct authoritative Swagger annotations

Edit the go-swagger `swagger:operation` godoc comments in `api/message.go`. Update the `default:` value for the `limit` query parameter on both affected operations so it matches the intentional runtime default in `withPaging`.

Annotations are authoritative; do not hand-edit `docs/spec.json`.

### 5. Regenerate the OpenAPI specification

From the **repository root**:

```bash
make update-swagger
```

This runs `swagger generate spec --scan-models -o docs/spec.json` and post-processes `uint64` → `int64`. Commit the updated `docs/spec.json` with the annotation changes.

### 6. Prove synchronization

From `syncguard/`:

```bash
npm run check-sync
```

Expect exit `0` and `status: synchronized`.

### 7. Generate a closure report (optional)

Re-run SDK analysis on the synchronized evidence:

```bash
npm run sdk-analyze
```

The report switches to post-remediation closure mode when evidence status is `synchronized`.

## CI behavior

Workflow: `.github/workflows/syncguard.yml`

Triggers on push and pull_request when paths change under:

- `api/**`
- `docs/spec.json`
- `syncguard/**`
- `.github/workflows/syncguard.yml`

Job steps (Node **22**, `fetch-depth: 0` for Git baseline access):

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run check-sync`

Within the SyncGuard workflow, `check-sync` is the sole documentation-sync pass/fail authority. No `CURSOR_API_KEY` is configured and no SDK commands run in CI.

| Outcome | Exit code |
|---------|-----------|
| Synchronized (runtime changed, docs match) | 0 |
| No relevant runtime change since baseline | 0 |
| Proven drift | 2 |
| Inconclusive comparison or job error | 1 |

## Evidence and reports

All artifacts live under `syncguard/artifacts/`:

| File | Producer | Type | Overwritten on re-run? |
|------|----------|------|------------------------|
| `deterministic-evidence.json` | `detect-drift`, `check-sync` | Deterministic, machine-readable | Yes |
| `sdk-drift-report.md` | `sdk-analyze` | SDK-generated, human-readable | Yes |

**Deterministic evidence** is the source of truth for what drift exists. It contains only parsed values and derived status — no LLM judgment.

**SDK reports** explain proven drift or confirmed synchronization for humans. They must not contradict the evidence JSON. The SDK validates required Markdown headings before writing the file.

Running `detect-drift` or `check-sync` overwrites `deterministic-evidence.json`. Running `sdk-analyze` overwrites `sdk-drift-report.md`. Use `--output` to write elsewhere without clobbering defaults.

## Demo walkthrough

A 3–5 minute interview demo that runs entirely on your **current synchronized branch**. Do not commit the temporary drift edits — discard them when finished.

Local Git tags (`demo-00-baseline`, `demo-01-drift`, `demo-02-sdk-analysis`, `demo-03-synchronized`) mark development milestones during SyncGuard construction. Only `demo-00-baseline` is confirmed on the GitHub remote; the later tags predate Phase 4A and do not include `npm run check-sync`. They are not used as runnable demo checkpoints.

**Prerequisites:** Node ≥ 22.13, `npm ci` in `syncguard/`, and `CURSOR_API_KEY` exported for SDK steps.

Begin only with a **clean working tree** — cleanup uses `git restore`:

```bash
git status --short
# (no output — proceed; otherwise commit or stash unrelated changes first)
```

### 1. Confirm synchronized starting point

From `syncguard/`:

```bash
cd syncguard
npm run check-sync
# check-sync: pass (status=synchronized, exit=0)
```

### 2. Introduce temporary documentation drift

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
# check-sync: fail (status=drift_detected, exit=2)
```

### 3. Examine evidence and generate an SDK drift report

Still in `syncguard/`:

```bash
cat artifacts/deterministic-evidence.json

export CURSOR_API_KEY=cursor_...
npm run sdk-analyze
# read artifacts/sdk-drift-report.md
```

### 4. Remediate annotations and regenerate the spec

In `api/message.go`, restore both `limit` annotation defaults to `50`.

From the **Gotify repository root**:

```bash
cd ..   # if currently in syncguard/
make update-swagger
```

### 5. Prove closure and generate the SDK closure report

From `syncguard/`:

```bash
cd syncguard
npm run check-sync
# check-sync: pass (status=synchronized, exit=0)

npm run sdk-analyze
# closure report in artifacts/sdk-drift-report.md
```

### 6. Restore a clean working tree

From the repository root:

```bash
cd ..
git diff --check
git restore api/message.go docs/spec.json
git diff --check
```

This discards the temporary annotation edits and regenerated spec from the demo. Artifact files under `syncguard/artifacts/` may still differ from HEAD; restore them too if needed (`git restore syncguard/artifacts/`).

**Note on real runtime changes:** When an intentional runtime API contract change (not just stale docs) alters pagination behavior, independent Gotify behavioral tests — for example expectations in `api/message_test.go` — may also need updating. A complete change should pass both the **SyncGuard workflow** (`.github/workflows/syncguard.yml`) and the **Gotify build workflow** (`.github/workflows/build.yml`).

## Scope and limitations

- **Narrow check scope** — Only the pagination `limit` default for `getMessages` and `getAppMessages` is validated. Other parameters, endpoints, and schema fields are out of scope.
- **Baseline dependency** — Detection requires a valid Git ref accessible via `git show <base-ref>:api/message.go`. The default baseline is the local tag `demo-00-baseline` (also on the GitHub remote). Shallow clones without that ref will fail or produce inconclusive results. CI uses `fetch-depth: 0`.
- **SDK is local and optional** — `sdk-analyze` requires `CURSOR_API_KEY`, network access, and Node ≥ 22.13. CI does not run it.
- **Deterministic comparison is authoritative** — An LLM never decides whether values match. The SDK explains evidence; `check-sync` enforces it.
- **Annotation-first remediation** — Fix swagger godoc comments, then regenerate with `make update-swagger`. Editing `docs/spec.json` directly without updating annotations will be overwritten on the next generation and will fail Gotify’s `make check-swagger` guard.
- **Historical demo tags** — Local tags `demo-01-drift`, `demo-02-sdk-analysis`, and `demo-03-synchronized` record intermediate milestones but are not required (or suitable) for running the Phase 4 demo; use the branch-local walkthrough above instead.
