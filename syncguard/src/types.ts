/** Phase 1 deterministic drift detector — shared types. */

export type AnalysisStatus =
  | "no_relevant_change"
  | "synchronized"
  | "drift_detected"
  | "inconclusive";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export interface RuntimeValue {
  value: number;
  /** 1-based source line of the runtime field value, when determinable. */
  line?: number;
}

export interface OperationDescriptor {
  operationId: string;
  method: string;
  path: string;
}

export interface OperationEvidenceInput extends OperationDescriptor {
  annotationDefault: ParseResult<number>;
  generatedSpecDefault: ParseResult<number>;
}

export interface RuntimeSourceRef {
  file: string;
  symbol: string;
  field: string;
}

export interface CompareInput {
  checkId: string;
  baseRef: string;
  runtimeSource: RuntimeSourceRef;
  baselineRuntime: ParseResult<RuntimeValue>;
  currentRuntime: ParseResult<RuntimeValue>;
  operations: OperationEvidenceInput[];
}

export interface RuntimeChange {
  source: RuntimeSourceRef;
  baselineValue: number;
  currentValue: number;
  baselineLine?: number;
  currentLine?: number;
}

export interface OperationResult {
  operationId: string;
  method: string;
  path: string;
  runtimeDefault: number;
  annotationDefault?: number;
  generatedSpecDefault?: number;
  status: AnalysisStatus;
}

export interface Evidence {
  schemaVersion: 1;
  checkId: string;
  baseRef: string;
  status: AnalysisStatus;
  /** Present only when status is "inconclusive"; deterministic order. */
  reasons?: string[];
  /** Present only when both runtime values were extracted. */
  runtimeChange?: RuntimeChange;
  /** Present only when both runtime values were extracted; path-sorted. */
  affectedOperations?: OperationResult[];
}

/** Runtime change record for configuration-to-env-example evidence. */
export interface ConfigRuntimeChange {
  source: RuntimeSourceRef;
  baselineValue: number | null;
  currentValue: number | null;
}

/** Operator-facing documentation target for a configuration default. */
export interface ConfigDocumentation {
  file: string;
  envVariable: string;
  documentedDefault: number | null;
}

/** Deterministic evidence for a Go config default vs env-example documentation. */
export interface ConfigEnvEvidence {
  schemaVersion: 1;
  checkId: string;
  contractKind: "config-env-example";
  baseRef: string;
  status: AnalysisStatus;
  runtimeChange: ConfigRuntimeChange;
  documentation: ConfigDocumentation;
  /** Present only when status is "inconclusive" or when drift/sync facts are reported. */
  reasons?: string[];
}

export type DeterministicEvidence = Evidence | ConfigEnvEvidence;

export interface ConfigDocCompareInput {
  checkId: string;
  baseRef: string;
  runtimeSource: RuntimeSourceRef;
  documentationFile: string;
  envVariable: string;
  baselineRuntime: ParseResult<number>;
  currentRuntime: ParseResult<number>;
  documentedDefault: ParseResult<number>;
}
