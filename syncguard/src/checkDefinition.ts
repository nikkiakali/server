/**
 * Declared definition for the Gotify pagination-default SyncGuard check.
 *
 * Paths, symbols, parameter names, and operation IDs that identify this specific
 * check live here — not in generic comparison / serialization helpers.
 *
 * Numeric defaults are never declared here; parsers extract them from source.
 */
import type { OperationDescriptor } from "./types.js";

export interface RuntimeSourceLocation {
  /** Repository-relative path to the Go source file. */
  file: string;
  /** Function symbol that applies the runtime default. */
  symbol: string;
  /** Struct field that holds the numeric default. */
  field: string;
  /** Go composite literal type searched inside the symbol function body. */
  compositeLiteralType: string;
}

export interface PaginationDefaultCheck {
  checkId: "gotify-pagination-default";
  runtimeSource: RuntimeSourceLocation;
  /** Repository-relative path to the generated Swagger 2.0 document. */
  generatedSpecFile: string;
  /** Query parameter name in annotations and the generated spec. */
  parameterName: string;
  /**
   * Operations that share the runtime default. Ordering is not significant —
   * compare() sorts by path for stable evidence output.
   */
  operations: readonly OperationDescriptor[];
  /** Default artifact path relative to the repository root. */
  defaultOutputRelPath: string;
}

export const PAGINATION_DEFAULT_CHECK: PaginationDefaultCheck = {
  checkId: "gotify-pagination-default",
  runtimeSource: {
    file: "api/message.go",
    symbol: "withPaging",
    field: "Limit",
    compositeLiteralType: "pagingParams",
  },
  generatedSpecFile: "docs/spec.json",
  parameterName: "limit",
  operations: [
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
  ],
  defaultOutputRelPath: "syncguard/artifacts/deterministic-evidence.json",
};

/** Operator-facing env-example documentation target for a configuration check. */
export interface EnvExampleDocumentationTarget {
  /** Repository-relative path to the env-example file. */
  file: string;
  /** Environment variable name documented in the example file. */
  envVariable: string;
}

/** Declared definition for a Go config default vs env-example documentation check. */
export interface ConfigEnvDefaultCheck {
  checkId: "gotify-stream-ping-default";
  contractKind: "config-env-example";
  /** Default git baseline ref for runtime comparison. */
  baseRef: string;
  runtime: RuntimeSourceLocation;
  documentation: EnvExampleDocumentationTarget;
  /** Default artifact path relative to the repository root. */
  defaultOutputRelPath: string;
}

export const STREAM_PING_DEFAULT_CHECK: ConfigEnvDefaultCheck = {
  checkId: "gotify-stream-ping-default",
  contractKind: "config-env-example",
  baseRef: "demo-00-baseline",
  runtime: {
    file: "config/config.go",
    symbol: "Get",
    field: "PingPeriodSeconds",
    compositeLiteralType: "Stream",
  },
  documentation: {
    file: "gotify-server.env.example",
    envVariable: "GOTIFY_SERVER_STREAM_PINGPERIODSECONDS",
  },
  defaultOutputRelPath: "syncguard/artifacts/deterministic-evidence-stream-ping.json",
};
