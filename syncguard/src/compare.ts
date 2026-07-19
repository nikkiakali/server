/**
 * Pure status derivation for SyncGuard checks.
 *
 * Numeric thresholds and check-specific paths are supplied by the caller (check
 * definition + parsers). This module only compares provided values.
 *
 * Top-level precedence:
 * 1. Runtime evidence missing/ambiguous/unparsable → inconclusive
 * 2. Baseline runtime equals current runtime → no_relevant_change
 * 3. Any required endpoint annotation or generated-spec inconclusive → inconclusive
 * 4. Any endpoint annotation or generated-spec differs from current runtime → drift_detected
 * 5. Otherwise → synchronized
 */
import type {
  AnalysisStatus,
  CompareInput,
  Evidence,
  OperationEvidenceInput,
  OperationResult,
  RuntimeChange,
  RuntimeSourceRef,
  RuntimeValue,
} from "./types.js";

function sortOperations(ops: OperationEvidenceInput[]): OperationEvidenceInput[] {
  return [...ops].sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    return a.operationId.localeCompare(b.operationId);
  });
}

function buildRuntimeChange(
  source: RuntimeSourceRef,
  baseline: RuntimeValue,
  current: RuntimeValue,
): RuntimeChange {
  const change: RuntimeChange = {
    source: {
      file: source.file,
      symbol: source.symbol,
      field: source.field,
    },
    baselineValue: baseline.value,
    currentValue: current.value,
  };
  if (baseline.line !== undefined) change.baselineLine = baseline.line;
  if (current.line !== undefined) change.currentLine = current.line;
  return change;
}

function endpointStatus(
  topLevelNoChange: boolean,
  currentRuntime: number,
  annotation: OperationEvidenceInput["annotationDefault"],
  generated: OperationEvidenceInput["generatedSpecDefault"],
): { status: AnalysisStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (!annotation.ok) {
    reasons.push(annotation.reason);
    return { status: "inconclusive", reasons };
  }
  if (!generated.ok) {
    reasons.push(generated.reason);
    return { status: "inconclusive", reasons };
  }
  if (topLevelNoChange) {
    return { status: "no_relevant_change", reasons };
  }
  if (annotation.value !== currentRuntime || generated.value !== currentRuntime) {
    return { status: "drift_detected", reasons };
  }
  return { status: "synchronized", reasons };
}

export function compare(input: CompareInput): Evidence {
  const base: Evidence = {
    schemaVersion: 1,
    checkId: input.checkId,
    baseRef: input.baseRef,
    status: "inconclusive",
  };

  if (!input.baselineRuntime.ok || !input.currentRuntime.ok) {
    const reasons: string[] = [];
    if (!input.baselineRuntime.ok) {
      reasons.push(`baseline runtime: ${input.baselineRuntime.reason}`);
    }
    if (!input.currentRuntime.ok) {
      reasons.push(`current runtime: ${input.currentRuntime.reason}`);
    }
    return { ...base, status: "inconclusive", reasons };
  }

  const baseline = input.baselineRuntime.value;
  const current = input.currentRuntime.value;
  const runtimeChange = buildRuntimeChange(input.runtimeSource, baseline, current);
  const operations = sortOperations(input.operations);
  const topLevelNoChange = baseline.value === current.value;

  const affected: OperationResult[] = [];
  const inconclusiveReasons: string[] = [];
  let anyEndpointInconclusive = false;
  let anyEndpointDrift = false;

  for (const op of operations) {
    const { status, reasons } = endpointStatus(
      topLevelNoChange,
      current.value,
      op.annotationDefault,
      op.generatedSpecDefault,
    );
    const result: OperationResult = {
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      runtimeDefault: current.value,
      status,
    };
    if (op.annotationDefault.ok) {
      result.annotationDefault = op.annotationDefault.value;
    }
    if (op.generatedSpecDefault.ok) {
      result.generatedSpecDefault = op.generatedSpecDefault.value;
    }
    affected.push(result);

    if (status === "inconclusive") {
      anyEndpointInconclusive = true;
      for (const r of reasons) {
        inconclusiveReasons.push(`${op.operationId}: ${r}`);
      }
    } else if (status === "drift_detected") {
      anyEndpointDrift = true;
    }
  }

  if (topLevelNoChange) {
    return {
      ...base,
      status: "no_relevant_change",
      runtimeChange,
      affectedOperations: affected,
    };
  }

  // Runtime changed: inconclusive endpoint evidence wins over confirmed drift.
  if (anyEndpointInconclusive) {
    return {
      ...base,
      status: "inconclusive",
      reasons: inconclusiveReasons,
      runtimeChange,
      affectedOperations: affected,
    };
  }

  if (anyEndpointDrift) {
    return {
      ...base,
      status: "drift_detected",
      runtimeChange,
      affectedOperations: affected,
    };
  }

  return {
    ...base,
    status: "synchronized",
    runtimeChange,
    affectedOperations: affected,
  };
}

/** Map analysis status to process exit code when --fail-on-drift is set. */
export function failOnDriftExitCode(status: AnalysisStatus): number {
  switch (status) {
    case "synchronized":
    case "no_relevant_change":
      return 0;
    case "drift_detected":
      return 2;
    case "inconclusive":
      return 1;
  }
}
