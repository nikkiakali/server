/** Stable JSON serialization — fixed key order, trailing newline, no volatile fields. */
import type {
  ConfigEnvEvidence,
  ConfigRuntimeChange,
  Evidence,
  OperationResult,
  RuntimeChange,
} from "./types.js";

function serializeRuntimeChange(change: RuntimeChange): Record<string, unknown> {
  const source: Record<string, string> = {
    file: change.source.file,
    symbol: change.source.symbol,
    field: change.source.field,
  };
  const out: Record<string, unknown> = {
    source,
    baselineValue: change.baselineValue,
    currentValue: change.currentValue,
  };
  if (change.baselineLine !== undefined) out.baselineLine = change.baselineLine;
  if (change.currentLine !== undefined) out.currentLine = change.currentLine;
  return out;
}

function serializeOperation(op: OperationResult): Record<string, unknown> {
  const out: Record<string, unknown> = {
    operationId: op.operationId,
    method: op.method,
    path: op.path,
    runtimeDefault: op.runtimeDefault,
  };
  if (op.annotationDefault !== undefined) {
    out.annotationDefault = op.annotationDefault;
  }
  if (op.generatedSpecDefault !== undefined) {
    out.generatedSpecDefault = op.generatedSpecDefault;
  }
  out.status = op.status;
  return out;
}

/** Build a plain object with deterministic insertion order, then stringify. */
export function serializeEvidence(evidence: Evidence): string {
  const out: Record<string, unknown> = {
    schemaVersion: evidence.schemaVersion,
    checkId: evidence.checkId,
    baseRef: evidence.baseRef,
    status: evidence.status,
  };
  if (evidence.reasons !== undefined) {
    out.reasons = evidence.reasons;
  }
  if (evidence.runtimeChange !== undefined) {
    out.runtimeChange = serializeRuntimeChange(evidence.runtimeChange);
  }
  if (evidence.affectedOperations !== undefined) {
    out.affectedOperations = evidence.affectedOperations.map(serializeOperation);
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function formatSummary(evidence: Evidence): string {
  const lines: string[] = [];
  lines.push(`status: ${evidence.status}`);
  lines.push(`base-ref: ${evidence.baseRef}`);

  if (evidence.runtimeChange) {
    const field = evidence.runtimeChange.source.field;
    lines.push(
      `runtime ${field}: baseline=${evidence.runtimeChange.baselineValue} current=${evidence.runtimeChange.currentValue}`,
    );
  }

  if (evidence.affectedOperations) {
    for (const op of evidence.affectedOperations) {
      const ann =
        op.annotationDefault !== undefined ? String(op.annotationDefault) : "(missing)";
      const gen =
        op.generatedSpecDefault !== undefined
          ? String(op.generatedSpecDefault)
          : "(missing)";
      lines.push(
        `${op.method} ${op.path}: annotation=${ann} generated-spec=${gen} → ${op.status}`,
      );
    }
  }

  if (evidence.reasons?.length) {
    lines.push("reasons:");
    for (const r of evidence.reasons) {
      lines.push(`  - ${r}`);
    }
  }

  return lines.join("\n");
}

function serializeConfigRuntimeChange(change: ConfigRuntimeChange): Record<string, unknown> {
  return {
    source: {
      file: change.source.file,
      symbol: change.source.symbol,
      field: change.source.field,
    },
    baselineValue: change.baselineValue,
    currentValue: change.currentValue,
  };
}

/** Build deterministic JSON for configuration-env-example evidence. */
export function serializeConfigEnvEvidence(evidence: ConfigEnvEvidence): string {
  const out: Record<string, unknown> = {
    schemaVersion: evidence.schemaVersion,
    checkId: evidence.checkId,
    contractKind: evidence.contractKind,
    baseRef: evidence.baseRef,
    status: evidence.status,
  };
  if (evidence.reasons !== undefined) {
    out.reasons = evidence.reasons;
  }
  out.runtimeChange = serializeConfigRuntimeChange(evidence.runtimeChange);
  out.documentation = {
    file: evidence.documentation.file,
    envVariable: evidence.documentation.envVariable,
    documentedDefault: evidence.documentation.documentedDefault,
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function formatConfigEnvSummary(evidence: ConfigEnvEvidence): string {
  const lines: string[] = [];

  const field = evidence.runtimeChange.source.field;
  lines.push(
    `runtime ${field}: baseline=${evidence.runtimeChange.baselineValue} current=${evidence.runtimeChange.currentValue}`,
  );
  lines.push(
    `${evidence.documentation.envVariable}: documented=${evidence.documentation.documentedDefault}`,
  );

  if (evidence.reasons?.length) {
    lines.push("reasons:");
    for (const r of evidence.reasons) {
      lines.push(`  - ${r}`);
    }
  }

  return lines.join("\n");
}
