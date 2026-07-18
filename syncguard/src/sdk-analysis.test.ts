import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  REQUIRED_REPORT_HEADINGS,
  SdkAnalysisError,
  assertUsableDriftEvidence,
  buildAnalysisPrompt,
  loadDriftEvidence,
  parseEvidenceJson,
  validateDriftReport,
} from "./sdk-analysis.js";
import type { Evidence } from "./types.js";

const VALID_EVIDENCE: Evidence = {
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
  it("1: accepts valid drift evidence", () => {
    const evidence = parseEvidenceJson(JSON.stringify(VALID_EVIDENCE));
    assertUsableDriftEvidence(evidence);
    assert.equal(evidence.status, "drift_detected");
    assert.equal(evidence.runtimeChange?.currentValue, 50);
  });

  it("loads valid evidence from a temporary file", () => {
    const dir = mkdtempSync(join(tmpdir(), "syncguard-sdk-"));
    const path = join(dir, "evidence.json");
    writeFileSync(path, `${JSON.stringify(VALID_EVIDENCE, null, 2)}\n`, "utf8");
    const evidence = loadDriftEvidence(path);
    assert.equal(evidence.checkId, "gotify-pagination-default");
  });

  it("rejects a missing evidence file", () => {
    assert.throws(
      () => loadDriftEvidence(join(tmpdir(), "syncguard-missing-evidence.json")),
      (err: unknown) => {
        assert.ok(err instanceof SdkAnalysisError);
        assert.match(err.message, /missing evidence file/);
        return true;
      },
    );
  });

  it("2: rejects invalid JSON", () => {
    assert.throws(
      () => parseEvidenceJson("{not-json", "fixture"),
      (err: unknown) => {
        assert.ok(err instanceof SdkAnalysisError);
        assert.match(err.message, /invalid JSON/);
        return true;
      },
    );
  });

  it("3: rejects structurally invalid evidence", () => {
    assert.throws(
      () =>
        parseEvidenceJson(
          JSON.stringify({ schemaVersion: 1, checkId: "wrong", baseRef: "x", status: "drift_detected" }),
          "fixture",
        ),
      /unexpected checkId/,
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

  it("rejects evidence with no usable drift finding", () => {
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
    assert.throws(
      () =>
        assertUsableDriftEvidence({
          ...VALID_EVIDENCE,
          affectedOperations: [
            {
              ...VALID_EVIDENCE.affectedOperations![0]!,
              status: "synchronized",
            },
          ],
        }),
      /no usable drift finding/,
    );
  });
});

describe("sdk-analysis prompt", () => {
  it("4: contains the supplied evidence JSON", () => {
    const prompt = buildAnalysisPrompt(VALID_EVIDENCE);
    assert.match(prompt, /"baselineValue": 100/);
    assert.match(prompt, /"currentValue": 50/);
    assert.match(prompt, /"path": "\/message"/);
    assert.match(prompt, /api\/message\.go/);
  });

  it("5: includes no-guessing and no-modification rules", () => {
    const prompt = buildAnalysisPrompt(VALID_EVIDENCE);
    assert.match(prompt, /Do not guess repository facts/i);
    assert.match(prompt, /unknown from supplied evidence/);
    assert.match(prompt, /Do not modify files/i);
    assert.match(prompt, /Do not execute remediation/i);
    assert.match(prompt, /Do not inspect unrelated repository files/i);
  });

  it("6: requires every report heading", () => {
    const prompt = buildAnalysisPrompt(VALID_EVIDENCE);
    for (const heading of REQUIRED_REPORT_HEADINGS) {
      assert.ok(prompt.includes(heading), `prompt missing heading instruction: ${heading}`);
    }
  });
});

describe("sdk-analysis report validation", () => {
  it("7: accepts a complete report", () => {
    const report = validateDriftReport(COMPLETE_REPORT);
    assert.match(report, /^# SyncGuard Drift Report/m);
    assert.ok(report.endsWith("\n"));
  });

  it("8: rejects an incomplete or empty report", () => {
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
