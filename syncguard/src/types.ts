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
