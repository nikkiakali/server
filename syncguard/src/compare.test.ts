import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAGINATION_DEFAULT_CHECK } from "./checkDefinition.js";
import { compare, failOnDriftExitCode } from "./compare.js";
import { serializeEvidence } from "./serialize.js";
import type { CompareInput, ParseResult } from "./types.js";

const CHECK = PAGINATION_DEFAULT_CHECK;

function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

function fail(reason: string): ParseResult<never> {
  return { ok: false, reason };
}

function ops(
  pairs: Array<{ annotation: ParseResult<number>; generated: ParseResult<number> }>,
): CompareInput["operations"] {
  return CHECK.operations.map((op, i) => ({
    ...op,
    annotationDefault: pairs[i]!.annotation,
    generatedSpecDefault: pairs[i]!.generated,
  }));
}

function input(
  partial: Omit<CompareInput, "checkId" | "runtimeSource" | "baseRef"> & {
    baseRef?: string;
  },
): CompareInput {
  return {
    checkId: CHECK.checkId,
    runtimeSource: CHECK.runtimeSource,
    baseRef: partial.baseRef ?? "demo-00-baseline",
    baselineRuntime: partial.baselineRuntime,
    currentRuntime: partial.currentRuntime,
    operations: partial.operations,
  };
}

describe("compare", () => {
  it("1: baseline 100 / current 50 / docs 100 → drift_detected", () => {
    const evidence = compare(
      input({
        baselineRuntime: ok({ value: 100, line: 1 }),
        currentRuntime: ok({ value: 50, line: 2 }),
        operations: ops([
          { annotation: ok(100), generated: ok(100) },
          { annotation: ok(100), generated: ok(100) },
        ]),
      }),
    );
    assert.equal(evidence.status, "drift_detected");
    assert.equal(evidence.runtimeChange?.baselineValue, 100);
    assert.equal(evidence.runtimeChange?.currentValue, 50);
    assert.equal(evidence.runtimeChange?.source.file, CHECK.runtimeSource.file);
    assert.equal(evidence.affectedOperations?.length, 2);
    assert.equal(evidence.affectedOperations?.[0]?.operationId, "getAppMessages");
    assert.equal(evidence.affectedOperations?.[1]?.operationId, "getMessages");
    assert.ok(evidence.affectedOperations?.every((o) => o.status === "drift_detected"));
  });

  it("2: runtime changed and docs match current → synchronized", () => {
    const evidence = compare(
      input({
        baselineRuntime: ok({ value: 100 }),
        currentRuntime: ok({ value: 50 }),
        operations: ops([
          { annotation: ok(50), generated: ok(50) },
          { annotation: ok(50), generated: ok(50) },
        ]),
      }),
    );
    assert.equal(evidence.status, "synchronized");
    assert.ok(evidence.affectedOperations?.every((o) => o.status === "synchronized"));
  });

  it("3: baseline equals current → no_relevant_change", () => {
    const evidence = compare(
      input({
        baselineRuntime: ok({ value: 100 }),
        currentRuntime: ok({ value: 100 }),
        operations: ops([
          { annotation: ok(100), generated: ok(100) },
          { annotation: ok(100), generated: ok(100) },
        ]),
      }),
    );
    assert.equal(evidence.status, "no_relevant_change");
    assert.ok(evidence.affectedOperations?.every((o) => o.status === "no_relevant_change"));
  });

  it("4: one endpoint synchronized and one stale → top-level drift_detected", () => {
    const evidence = compare(
      input({
        baselineRuntime: ok({ value: 100 }),
        currentRuntime: ok({ value: 50 }),
        operations: ops([
          { annotation: ok(50), generated: ok(50) },
          { annotation: ok(100), generated: ok(100) },
        ]),
      }),
    );
    assert.equal(evidence.status, "drift_detected");
    assert.equal(evidence.affectedOperations?.[0]?.status, "synchronized");
    assert.equal(evidence.affectedOperations?.[1]?.status, "drift_detected");
  });

  it("5: missing runtime evidence → inconclusive", () => {
    const evidence = compare(
      input({
        baselineRuntime: fail("not found"),
        currentRuntime: ok({ value: 50 }),
        operations: ops([
          { annotation: ok(100), generated: ok(100) },
          { annotation: ok(100), generated: ok(100) },
        ]),
      }),
    );
    assert.equal(evidence.status, "inconclusive");
    assert.ok(evidence.reasons?.some((r) => r.includes("baseline runtime")));
  });

  it("6: missing annotation evidence → inconclusive (even with confirmed drift elsewhere)", () => {
    const evidence = compare(
      input({
        baselineRuntime: ok({ value: 100 }),
        currentRuntime: ok({ value: 50 }),
        operations: ops([
          { annotation: fail("missing annotation"), generated: ok(100) },
          { annotation: ok(100), generated: ok(100) },
        ]),
      }),
    );
    assert.equal(evidence.status, "inconclusive");
    assert.equal(evidence.affectedOperations?.[0]?.status, "inconclusive");
    assert.equal(evidence.affectedOperations?.[1]?.status, "drift_detected");
  });

  it("7: missing generated-spec evidence → inconclusive", () => {
    const evidence = compare(
      input({
        baselineRuntime: ok({ value: 100 }),
        currentRuntime: ok({ value: 50 }),
        operations: ops([
          { annotation: ok(100), generated: fail("missing spec") },
          { annotation: ok(100), generated: ok(100) },
        ]),
      }),
    );
    assert.equal(evidence.status, "inconclusive");
  });

  it("8: stable endpoint ordering getAppMessages then getMessages", () => {
    const evidence = compare(
      input({
        baselineRuntime: ok({ value: 100 }),
        currentRuntime: ok({ value: 50 }),
        operations: [
          {
            ...CHECK.operations[1]!,
            annotationDefault: ok(100),
            generatedSpecDefault: ok(100),
          },
          {
            ...CHECK.operations[0]!,
            annotationDefault: ok(100),
            generatedSpecDefault: ok(100),
          },
        ],
      }),
    );
    assert.deepEqual(
      evidence.affectedOperations?.map((o) => o.operationId),
      ["getAppMessages", "getMessages"],
    );
  });

  it("9: byte-for-byte stable serialization", () => {
    const evidence = compare(
      input({
        baselineRuntime: ok({ value: 100, line: 10 }),
        currentRuntime: ok({ value: 50, line: 11 }),
        operations: ops([
          { annotation: ok(100), generated: ok(100) },
          { annotation: ok(100), generated: ok(100) },
        ]),
      }),
    );
    const a = serializeEvidence(evidence);
    const b = serializeEvidence(evidence);
    assert.equal(a, b);
    assert.ok(a.endsWith("\n"));
    assert.match(a, /"status": "drift_detected"/);
  });

  it("10: --fail-on-drift exit codes", () => {
    assert.equal(failOnDriftExitCode("synchronized"), 0);
    assert.equal(failOnDriftExitCode("no_relevant_change"), 0);
    assert.equal(failOnDriftExitCode("drift_detected"), 2);
    assert.equal(failOnDriftExitCode("inconclusive"), 1);
  });

  it("genericity: non-demo values 73→41 with stale docs → drift_detected", () => {
    const evidence = compare(
      input({
        baselineRuntime: ok({ value: 73, line: 9 }),
        currentRuntime: ok({ value: 41, line: 18 }),
        operations: ops([
          { annotation: ok(73), generated: ok(73) },
          { annotation: ok(73), generated: ok(73) },
        ]),
      }),
    );
    assert.equal(evidence.status, "drift_detected");
    assert.equal(evidence.runtimeChange?.baselineValue, 73);
    assert.equal(evidence.runtimeChange?.currentValue, 41);
    assert.ok(
      evidence.affectedOperations?.every(
        (o) =>
          o.runtimeDefault === 41 &&
          o.annotationDefault === 73 &&
          o.generatedSpecDefault === 73 &&
          o.status === "drift_detected",
      ),
    );
  });

  it("genericity: non-demo values 73→41 with aligned docs → synchronized", () => {
    const evidence = compare(
      input({
        baselineRuntime: ok({ value: 73 }),
        currentRuntime: ok({ value: 41 }),
        operations: ops([
          { annotation: ok(41), generated: ok(41) },
          { annotation: ok(41), generated: ok(41) },
        ]),
      }),
    );
    assert.equal(evidence.status, "synchronized");
    assert.equal(evidence.runtimeChange?.baselineValue, 73);
    assert.equal(evidence.runtimeChange?.currentValue, 41);
    assert.ok(
      evidence.affectedOperations?.every(
        (o) =>
          o.runtimeDefault === 41 &&
          o.annotationDefault === 41 &&
          o.generatedSpecDefault === 41 &&
          o.status === "synchronized",
      ),
    );
  });
});
