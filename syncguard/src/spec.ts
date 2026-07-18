/**
 * Swagger 2.0 generated-spec evidence parser for docs/spec.json.
 * Narrow property access on known operations; not a general OpenAPI toolchain.
 */
import type { OperationDescriptor, ParseResult } from "./types.js";

export type SwaggerDocument = Record<string, unknown>;

export function parseSwaggerSpec(specText: string): ParseResult<SwaggerDocument> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(specText);
  } catch {
    return { ok: false, reason: "docs/spec.json is not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "docs/spec.json is not a JSON object" };
  }
  const doc = parsed as SwaggerDocument;
  if (doc["swagger"] !== "2.0") {
    return { ok: false, reason: "docs/spec.json is not a Swagger 2.0 document" };
  }
  return { ok: true, value: doc };
}

export function specLimitDefault(
  spec: SwaggerDocument,
  operation: OperationDescriptor,
): ParseResult<number> {
  const method = operation.method.toLowerCase();
  const paths = spec["paths"];
  if (typeof paths !== "object" || paths === null) {
    return { ok: false, reason: "docs/spec.json has no paths object" };
  }

  const pathItem = (paths as Record<string, unknown>)[operation.path];
  if (typeof pathItem !== "object" || pathItem === null) {
    return { ok: false, reason: `path ${operation.path} not found in docs/spec.json` };
  }

  const op = (pathItem as Record<string, unknown>)[method];
  if (typeof op !== "object" || op === null) {
    return {
      ok: false,
      reason: `operation ${operation.method} ${operation.path} not found in docs/spec.json`,
    };
  }

  const parameters = (op as Record<string, unknown>)["parameters"];
  if (!Array.isArray(parameters)) {
    return {
      ok: false,
      reason: `no parameters array for ${operation.method} ${operation.path} in docs/spec.json`,
    };
  }

  const limitParams = parameters.filter(
    (p): p is Record<string, unknown> =>
      typeof p === "object" &&
      p !== null &&
      (p as Record<string, unknown>)["name"] === "limit" &&
      (p as Record<string, unknown>)["in"] === "query",
  );
  if (limitParams.length === 0) {
    return {
      ok: false,
      reason: `no limit query parameter for ${operation.method} ${operation.path} in docs/spec.json`,
    };
  }
  if (limitParams.length > 1) {
    return {
      ok: false,
      reason: `multiple limit query parameters for ${operation.method} ${operation.path} in docs/spec.json`,
    };
  }

  const defaultValue = limitParams[0]!["default"];
  if (typeof defaultValue !== "number" || !Number.isInteger(defaultValue)) {
    return {
      ok: false,
      reason: `limit parameter for ${operation.method} ${operation.path} has no integer default in docs/spec.json`,
    };
  }

  return { ok: true, value: defaultValue };
}
