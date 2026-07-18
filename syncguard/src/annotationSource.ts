/**
 * Gotify-specific Swagger annotation parser.
 *
 * Reads go-swagger `swagger:operation` godoc comment blocks in api/message.go
 * and extracts the `default:` of the `limit` query parameter for a specific
 * operation. Not a general YAML or OpenAPI parser.
 */
import type { OperationDescriptor, ParseResult } from "./types.js";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMMENT_PREFIX = /^\s*\/\/ ?/;

export function parseAnnotationLimitDefault(
  goSource: string,
  operation: OperationDescriptor,
): ParseResult<number> {
  const lines = goSource.split("\n");
  const headerPattern = new RegExp(
    `swagger:operation\\s+${escapeRegExp(operation.method)}\\s+${escapeRegExp(operation.path)}\\s+\\S+\\s+${escapeRegExp(operation.operationId)}\\s*$`,
  );

  const headerIndexes = lines
    .map((line, i) => (COMMENT_PREFIX.test(line) && headerPattern.test(line) ? i : -1))
    .filter((i) => i !== -1);

  if (headerIndexes.length === 0) {
    return {
      ok: false,
      reason: `swagger:operation block for ${operation.method} ${operation.path} (${operation.operationId}) not found`,
    };
  }
  if (headerIndexes.length > 1) {
    return {
      ok: false,
      reason: `multiple swagger:operation blocks for ${operation.operationId} found`,
    };
  }

  const defaults: number[] = [];
  let inLimitParameter = false;

  for (let i = headerIndexes[0]! + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!COMMENT_PREFIX.test(raw)) break;

    const content = raw.replace(COMMENT_PREFIX, "").trim();
    if (content === "responses:") break;

    if (content.startsWith("- name:")) {
      inLimitParameter = /^-\s*name:\s*limit\s*$/.test(content);
      continue;
    }
    if (inLimitParameter) {
      const m = /^default:\s*(\d+)\s*$/.exec(content);
      if (m) defaults.push(Number.parseInt(m[1]!, 10));
    }
  }

  if (defaults.length === 0) {
    return {
      ok: false,
      reason: `no integer default for the limit parameter in the ${operation.operationId} annotation`,
    };
  }
  if (defaults.length > 1) {
    return {
      ok: false,
      reason: `ambiguous limit default in the ${operation.operationId} annotation (${defaults.length} values)`,
    };
  }

  return { ok: true, value: defaults[0]! };
}
