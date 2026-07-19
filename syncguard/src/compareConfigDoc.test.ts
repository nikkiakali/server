import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareConfigDoc } from "./compareConfigDoc.js";
import type { ConfigDocCompareInput, ParseResult } from "./types.js";

const CHECK_ID = "gotify-stream-ping-default";
const BASE_REF = "demo-00-baseline";
const RUNTIME_SOURCE = {
  file: "config/config.go",
  symbol: "Get",
  field: "PingPeriodSeconds",
};
const DOC_FILE = "gotify-server.env.example";
const ENV_VAR = "GOTIFY_SERVER_STREAM_PINGPERIODSECONDS";

function ok(value: number): ParseResult<number> {
  return { ok: true, value };
}

function fail(reason: string): ParseResult<never> {
  return { ok: false, reason };
}

function input(
  partial: Pick<
    ConfigDocCompareInput,
    "baselineRuntime" | "currentRuntime" | "documentedDefault"
  >,
): ConfigDocCompareInput {
  return {
    checkId: CHECK_ID,
    baseRef: BASE_REF,
    runtimeSource: RUNTIME_SOURCE,
    documentationFile: DOC_FILE,
    envVariable: ENV_VAR,
    ...partial,
  };
}

describe("compareConfigDoc", () => {
  it("1: baseline 45 / current 45 / documentation 45 → no_relevant_change", () => {
    const evidence = compareConfigDoc(
      input({
        baselineRuntime: ok(45),
        currentRuntime: ok(45),
        documentedDefault: ok(45),
      }),
    );

    assert.equal(evidence.status, "no_relevant_change");
    assert.equal(evidence.contractKind, "config-env-example");
    assert.equal(evidence.runtimeChange.baselineValue, 45);
    assert.equal(evidence.runtimeChange.currentValue, 45);
    assert.equal(evidence.documentation.documentedDefault, 45);
    assert.equal(evidence.documentation.file, DOC_FILE);
    assert.equal(evidence.documentation.envVariable, ENV_VAR);
    assert.equal("affectedOperations" in evidence, false);
  });

  it("2: baseline 45 / current 45 / documentation 60 → no_relevant_change", () => {
    const evidence = compareConfigDoc(
      input({
        baselineRuntime: ok(45),
        currentRuntime: ok(45),
        documentedDefault: ok(60),
      }),
    );

    assert.equal(evidence.status, "no_relevant_change");
    assert.equal(evidence.documentation.documentedDefault, 60);
  });

  it("3: baseline 45 / current 60 / documentation 45 → drift_detected", () => {
    const evidence = compareConfigDoc(
      input({
        baselineRuntime: ok(45),
        currentRuntime: ok(60),
        documentedDefault: ok(45),
      }),
    );

    assert.equal(evidence.status, "drift_detected");
    assert.deepEqual(evidence.reasons, [
      "Runtime default changed from 45 to 60.",
      "Documented default 45 does not match current runtime default 60.",
    ]);
  });

  it("4: baseline 45 / current 60 / documentation 60 → synchronized", () => {
    const evidence = compareConfigDoc(
      input({
        baselineRuntime: ok(45),
        currentRuntime: ok(60),
        documentedDefault: ok(60),
      }),
    );

    assert.equal(evidence.status, "synchronized");
    assert.deepEqual(evidence.reasons, [
      "Runtime default changed from 45 to 60.",
      "Documented default 60 matches current runtime default 60.",
    ]);
  });

  it("5: baseline runtime parse failure → inconclusive", () => {
    const evidence = compareConfigDoc(
      input({
        baselineRuntime: fail("func Get not found"),
        currentRuntime: ok(45),
        documentedDefault: ok(45),
      }),
    );

    assert.equal(evidence.status, "inconclusive");
    assert.equal(evidence.runtimeChange.baselineValue, null);
    assert.equal(evidence.runtimeChange.currentValue, 45);
    assert.match(evidence.reasons?.[0] ?? "", /baseline runtime: func Get not found/);
  });

  it("6: current runtime parse failure → inconclusive", () => {
    const evidence = compareConfigDoc(
      input({
        baselineRuntime: ok(45),
        currentRuntime: fail("no numeric PingPeriodSeconds field"),
        documentedDefault: ok(45),
      }),
    );

    assert.equal(evidence.status, "inconclusive");
    assert.equal(evidence.runtimeChange.baselineValue, 45);
    assert.equal(evidence.runtimeChange.currentValue, null);
    assert.match(evidence.reasons?.[0] ?? "", /current runtime: no numeric PingPeriodSeconds field/);
  });

  it("7: runtime changed and documentation parse failed → inconclusive", () => {
    const evidence = compareConfigDoc(
      input({
        baselineRuntime: ok(45),
        currentRuntime: ok(60),
        documentedDefault: fail("no commented integer assignment for GOTIFY_SERVER_STREAM_PINGPERIODSECONDS"),
      }),
    );

    assert.equal(evidence.status, "inconclusive");
    assert.equal(evidence.runtimeChange.baselineValue, 45);
    assert.equal(evidence.runtimeChange.currentValue, 60);
    assert.equal(evidence.documentation.documentedDefault, null);
    assert.match(evidence.reasons?.[0] ?? "", /Runtime default changed from 45 to 60/);
    assert.match(
      evidence.reasons?.[1] ?? "",
      /documented default: no commented integer assignment/,
    );
  });

  it("8: evidence shape has documentation block and no affectedOperations", () => {
    const evidence = compareConfigDoc(
      input({
        baselineRuntime: ok(45),
        currentRuntime: ok(60),
        documentedDefault: ok(60),
      }),
    );

    assert.equal(evidence.contractKind, "config-env-example");
    assert.equal(evidence.documentation.file, DOC_FILE);
    assert.equal(evidence.documentation.envVariable, ENV_VAR);
    assert.equal(typeof evidence.documentation.documentedDefault, "number");
    assert.equal("affectedOperations" in evidence, false);
    assert.equal("annotationDefault" in evidence, false);
    assert.equal("generatedSpecDefault" in evidence, false);
    assert.equal("operationId" in evidence, false);
  });
});
