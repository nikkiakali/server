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
  /** 1-based source line of the Limit value, when determinable. */
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

export interface CompareInput {
  baseRef: string;
  baselineRuntime: ParseResult<RuntimeValue>;
  currentRuntime: ParseResult<RuntimeValue>;
  operations: OperationEvidenceInput[];
}

export interface RuntimeChange {
  source: {
    file: string;
    symbol: string;
    field: string;
  };
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
  checkId: "gotify-pagination-default";
  baseRef: string;
  status: AnalysisStatus;
  /** Present only when status is "inconclusive"; deterministic order. */
  reasons?: string[];
  /** Present only when both runtime values were extracted. */
  runtimeChange?: RuntimeChange;
  /** Present only when both runtime values were extracted; path-sorted. */
  affectedOperations?: OperationResult[];
}

/** Fixed affected operations, path-sorted: application path before /message. */
export const AFFECTED_OPERATIONS: readonly OperationDescriptor[] = [
  {
    operationId: "getAppMessages",
    method: "GET",
    path: "/application/{id}/message",
  },
  {
    operationId: "getMessages",
    method: "GET",
    path: "/message",
  },
];
