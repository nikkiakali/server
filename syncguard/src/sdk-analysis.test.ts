import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  REQUIRED_REPORT_HEADINGS,
  SdkAnalysisError,
  assertUsableAnalysisEvidence,
  assertUsableDriftEvidence,
  buildAnalysisPrompt,
  loadAnalysisEvidence,
  loadDriftEvidence,
  parseEvidenceJson,
  validateDriftReport,
} from "./sdk-analysis.js";
import type { Evidence } from "./types.js";

const VALID_DRIFT_EVIDENCE: Evidence = {
  schemaVersion: 1,
  checkId: "gotify-pagination-default",
  baseRef: "demo-00-baseline",
  status: "drift_detected",
  runtimeChange: {
    source: {
      file: "api/message.go",
      symbol: "withPaging",
      field: "Limit",
    },
    baselineValue: 100,
    currentValue: 50,
    baselineLine: 122,
    currentLine: 122,
  },
  affectedOperations: [
    {
      operationId: "getAppMessages",
      method: "GET",
      path: "/application/{id}/message",
      runtimeDefault: 50,
      annotationDefault: 100,
      generatedSpecDefault: 100,
      status: "drift_detected",
    },
    {
      operationId: "getMessages",
      method: "GET",
      path: "/message",
      runtimeDefault: 50,
      annotationDefault: 100,
      generatedSpecDefault: 100,
      status: "drift_detected",
    },
  ],
};

const VALID_SYNCHRONIZED_EVIDENCE: Evidence = {
  schemaVersion: 1,
  checkId: "example-pagination-check",
  baseRef: "release-v1",
  status: "synchronized",
  runtimeChange: {
    source: {
      file: "pkg/handler.go",
      symbol: "applyPaging",
      field: "Limit",
    },
    baselineValue: 73,
    currentValue: 41,
  },
  affectedOperations: [
    {
      operationId: "listItems",
      method: "GET",
      path: "/items",
      runtimeDefault: 41,
      annotationDefault: 41,
      generatedSpecDefault: 41,
      status: "synchronized",
    },
  ],
};

const COMPLETE_REPORT = `# SyncGuard Drift Report

## Executive Summary

Drift was detected for check gotify-pagination-default against baseRef demo-00-baseline.

## Proven Drift

Runtime Limit changed from 100 to 50 in api/message.go (withPaging).
GET /message and GET /application/{id}/message still document annotation and generated-spec defaults of 100.

## Impact

API consumers that omit limit may receive fewer messages than the documented default.

## Remediation Recommendation

Recommendation: update swagger annotations and regenerate docs/spec.json to default 50 if the runtime change is intentional; otherwise restore runtime Limit to 100.

## Verification Steps

Recommendation: re-run \`npm run detect-drift -- --base-ref demo-00-baseline\` and expect synchronized or updated evidence.

## Runbook Update

Document that runtime pagination defaults in withPaging must stay aligned with swagger annotations and docs/spec.json.

## Assumptions and Confidence

Deterministic facts: baselineValue 100, currentValue 50, annotationDefault 100, generatedSpecDefault 100.
SDK interpretation: consumer impact wording and remediation preference.
`;

describe("sdk-analysis evidence loading", () => {
  it("1: accepts valid drift_detected evidence", () => {
    const evidence = parseEvidenceJson(JSON.stringify(VALID_DRIFT_EVIDENCE));
    assertUsableAnalysisEvidence(evidence);
    assert.equal(evidence.status, "drift_detected");
    assert.equal(evidence.runtimeChange?.currentValue, 50);
  });

  it("2: accepts valid synchronized evidence", () => {
    assertUsableAnalysisEvidence(VALID_SYNCHRONIZED_EVIDENCE);
    const evidence = parseEvidenceJson(JSON.stringify(VALID_SYNCHRONIZED_EVIDENCE));
    assertUsableAnalysisEvidence(evidence);
    assert.equal(evidence.runtimeChange?.currentValue, 41);
  });

  it("loads valid drift evidence from a temporary file", () => {
    const dir = mkdtempSync(join(tmpdir(), "syncguard-sdk-"));
    const path = join(dir, "evidence.json");
    writeFileSync(path, `${JSON.stringify(VALID_DRIFT_EVIDENCE, null, 2)}\n`, "utf8");
    const evidence = loadAnalysisEvidence(path);
    assert.equal(evidence.checkId, "gotify-pagination-default");
  });

  it("loads valid synchronized evidence from a temporary file", () => {
    const dir = mkdtempSync(join(tmpdir(), "syncguard-sdk-"));
    const path = join(dir, "evidence-sync.json");
    writeFileSync(path, `${JSON.stringify(VALID_SYNCHRONIZED_EVIDENCE, null, 2)}\n`, "utf8");
    const evidence = loadAnalysisEvidence(path);
    assert.equal(evidence.status, "synchronized");
  });

  it("loadAnalysisEvidence accepts synchronized fixture; loadDriftEvidence rejects it", () => {
    const dir = mkdtempSync(join(tmpdir(), "syncguard-sdk-"));
    const path = join(dir, "evidence-sync.json");
    writeFileSync(path, `${JSON.stringify(VALID_SYNCHRONIZED_EVIDENCE, null, 2)}\n`, "utf8");
    assert.equal(loadAnalysisEvidence(path).status, "synchronized");
    assert.throws(
      () => loadDriftEvidence(path),
      (err: unknown) => {
        assert.ok(err instanceof SdkAnalysisError);
        assert.match(err.message, /no usable drift finding/);
        return true;
      },
    );
  });

  it("loadDriftEvidence still accepts valid drift evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "syncguard-sdk-"));
    const path = join(dir, "evidence-drift.json");
    writeFileSync(path, `${JSON.stringify(VALID_DRIFT_EVIDENCE, null, 2)}\n`, "utf8");
    const evidence = loadDriftEvidence(path);
    assert.equal(evidence.status, "drift_detected");
  });

  it("rejects a missing evidence file", () => {
    assert.throws(
      () => loadAnalysisEvidence(join(tmpdir(), "syncguard-missing-evidence.json")),
      (err: unknown) => {
        assert.ok(err instanceof SdkAnalysisError);
        assert.match(err.message, /missing evidence file/);
        return true;
      },
    );
  });

  it("rejects invalid JSON", () => {
    assert.throws(
      () => parseEvidenceJson("{not-json", "fixture"),
      (err: unknown) => {
        assert.ok(err instanceof SdkAnalysisError);
        assert.match(err.message, /invalid JSON/);
        return true;
      },
    );
  });

  it("accepts valid evidence with a different non-empty checkId", () => {
    const evidence = parseEvidenceJson(
      JSON.stringify({ ...VALID_DRIFT_EVIDENCE, checkId: "other-check-id" }),
    );
    assert.equal(evidence.checkId, "other-check-id");
    assertUsableAnalysisEvidence(evidence);
  });

  it("rejects structurally invalid evidence", () => {
    assert.throws(
      () =>
        parseEvidenceJson(
          JSON.stringify({ schemaVersion: 1, checkId: "", baseRef: "x", status: "drift_detected" }),
          "fixture",
        ),
      /missing or invalid string field "checkId"/,
    );
    assert.throws(
      () =>
        parseEvidenceJson(
          JSON.stringify({
            schemaVersion: 1,
            checkId: "gotify-pagination-default",
            baseRef: "demo-00-baseline",
            status: "not-a-status",
          }),
          "fixture",
        ),
      /invalid status/,
    );
  });

  it("3: rejects malformed synchronized evidence", () => {
    assert.throws(
      () =>
        assertUsableAnalysisEvidence({
          schemaVersion: 1,
          checkId: "example-pagination-check",
          baseRef: "release-v1",
          status: "synchronized",
        }),
      /missing runtimeChange/,
    );
    assert.throws(
      () =>
        assertUsableAnalysisEvidence({
          ...VALID_SYNCHRONIZED_EVIDENCE,
          affectedOperations: [
            {
              ...VALID_SYNCHRONIZED_EVIDENCE.affectedOperations![0]!,
              status: "drift_detected",
            },
          ],
        }),
      /status is "drift_detected", expected "synchronized"/,
    );
    assert.throws(
      () =>
        assertUsableAnalysisEvidence({
          ...VALID_SYNCHRONIZED_EVIDENCE,
          affectedOperations: [
            {
              ...VALID_SYNCHRONIZED_EVIDENCE.affectedOperations![0]!,
              annotationDefault: 99,
            },
          ],
        }),
      /must all equal runtimeChange.currentValue/,
    );
  });

  it("4: rejects unsupported statuses", () => {
    assert.throws(
      () =>
        assertUsableAnalysisEvidence({
          schemaVersion: 1,
          checkId: "gotify-pagination-default",
          baseRef: "demo-00-baseline",
          status: "inconclusive",
        }),
      /unsupported evidence status "inconclusive"/,
    );
    assert.throws(
      () =>
        assertUsableAnalysisEvidence({
          schemaVersion: 1,
          checkId: "gotify-pagination-default",
          baseRef: "demo-00-baseline",
          status: "no_relevant_change",
          runtimeChange: VALID_DRIFT_EVIDENCE.runtimeChange,
          affectedOperations: VALID_DRIFT_EVIDENCE.affectedOperations,
        }),
      /unsupported evidence status "no_relevant_change"/,
    );
  });

  it("rejects drift_detected evidence with no drifted operations", () => {
    assert.throws(
      () =>
        assertUsableAnalysisEvidence({
          ...VALID_DRIFT_EVIDENCE,
          affectedOperations: [
            {
              ...VALID_DRIFT_EVIDENCE.affectedOperations![0]!,
              status: "synchronized",
              annotationDefault: 50,
              generatedSpecDefault: 50,
            },
          ],
        }),
      /no affectedOperations with status drift_detected/,
    );
    assert.throws(
      () =>
        assertUsableDriftEvidence({
          schemaVersion: 1,
          checkId: "gotify-pagination-default",
          baseRef: "demo-00-baseline",
          status: "synchronized",
        }),
      /no usable drift finding/,
    );
  });
});

describe("sdk-analysis prompt", () => {
  it("contains the supplied evidence JSON", () => {
    const prompt = buildAnalysisPrompt(VALID_DRIFT_EVIDENCE);
    assert.match(prompt, /"baselineValue": 100/);
    assert.match(prompt, /"currentValue": 50/);
    assert.match(prompt, /"path": "\/message"/);
    assert.match(prompt, /api\/message\.go/);
  });

  it("includes no-guessing and no-modification rules", () => {
    const prompt = buildAnalysisPrompt(VALID_DRIFT_EVIDENCE);
    assert.match(prompt, /Do not guess repository facts/i);
    assert.match(prompt, /unknown from supplied evidence/);
    assert.match(prompt, /Do not modify files/i);
    assert.match(prompt, /Do not execute remediation/i);
    assert.match(prompt, /Do not inspect unrelated repository files/i);
  });

  it("requires every report heading", () => {
    const prompt = buildAnalysisPrompt(VALID_DRIFT_EVIDENCE);
    for (const heading of REQUIRED_REPORT_HEADINGS) {
      assert.ok(prompt.includes(heading), `prompt missing heading instruction: ${heading}`);
    }
  });

  it("5: synchronized report instructions do not request remediation", () => {
    const prompt = buildAnalysisPrompt(VALID_SYNCHRONIZED_EVIDENCE);
    assert.match(prompt, /post-remediation verification \/ closure/);
    assert.match(prompt, /no further remediation is required/i);
    assert.match(prompt, /Do not recommend updating swagger annotations/i);
    assert.match(prompt, /Do not claim that every pagination-related test/i);
    assert.doesNotMatch(prompt, /which annotation \/ generated-spec defaults are stale/i);
  });

  it("6: drift report instructions continue to request remediation", () => {
    const prompt = buildAnalysisPrompt(VALID_DRIFT_EVIDENCE);
    assert.match(prompt, /open drift analysis/);
    assert.match(prompt, /documentation drift was detected/i);
    assert.match(prompt, /which annotation \/ generated-spec defaults are stale/i);
    assert.match(prompt, /safest remediation option/i);
    assert.match(prompt, /Do not state that remediation is already complete/i);
  });
});

describe("sdk-analysis report validation", () => {
  it("accepts a complete report", () => {
    const report = validateDriftReport(COMPLETE_REPORT);
    assert.match(report, /^# SyncGuard Drift Report/m);
    assert.ok(report.endsWith("\n"));
  });

  it("rejects an incomplete or empty report", () => {
    assert.throws(() => validateDriftReport(""), /empty/);
    assert.throws(() => validateDriftReport("   "), /empty/);
    assert.throws(
      () =>
        validateDriftReport(`# SyncGuard Drift Report

## Executive Summary

Only one section.
`),
      /missing required heading/,
    );
  });
});
