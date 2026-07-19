/**
 * Swagger 2.0 generated-spec evidence parser.
 * Narrow property access on known operations; not a general OpenAPI toolchain.
 *
 * The generated-spec file path and parameter name come from the check
 * definition at the call site — this module only navigates a parsed document.
 */
import type { OperationDescriptor, ParseResult } from "./types.js";

export type SwaggerDocument = Record<string, unknown>;

export function parseSwaggerSpec(specText: string): ParseResult<SwaggerDocument> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(specText);
  } catch {
    return { ok: false, reason: "generated specification is not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "generated specification is not a JSON object" };
  }
  const doc = parsed as SwaggerDocument;
  if (doc["swagger"] !== "2.0") {
    return { ok: false, reason: "generated specification is not a Swagger 2.0 document" };
  }
  return { ok: true, value: doc };
}

export function specParameterDefault(
  spec: SwaggerDocument,
  operation: OperationDescriptor,
  parameterName: string,
): ParseResult<number> {
  const method = operation.method.toLowerCase();
  const paths = spec["paths"];
  if (typeof paths !== "object" || paths === null) {
    return { ok: false, reason: "generated specification has no paths object" };
  }

  const pathItem = (paths as Record<string, unknown>)[operation.path];
  if (typeof pathItem !== "object" || pathItem === null) {
    return { ok: false, reason: `path ${operation.path} not found in generated specification` };
  }

  const op = (pathItem as Record<string, unknown>)[method];
  if (typeof op !== "object" || op === null) {
    return {
      ok: false,
      reason: `operation ${operation.method} ${operation.path} not found in generated specification`,
    };
  }

  const parameters = (op as Record<string, unknown>)["parameters"];
  if (!Array.isArray(parameters)) {
    return {
      ok: false,
      reason: `no parameters array for ${operation.method} ${operation.path} in generated specification`,
    };
  }

  const matches = parameters.filter(
    (p): p is Record<string, unknown> =>
      typeof p === "object" &&
      p !== null &&
      (p as Record<string, unknown>)["name"] === parameterName &&
      (p as Record<string, unknown>)["in"] === "query",
  );
  if (matches.length === 0) {
    return {
      ok: false,
      reason: `no ${parameterName} query parameter for ${operation.method} ${operation.path} in generated specification`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `multiple ${parameterName} query parameters for ${operation.method} ${operation.path} in generated specification`,
    };
  }

  const defaultValue = matches[0]!["default"];
  if (typeof defaultValue !== "number" || !Number.isInteger(defaultValue)) {
    return {
      ok: false,
      reason: `${parameterName} parameter for ${operation.method} ${operation.path} has no integer default in generated specification`,
    };
  }

  return { ok: true, value: defaultValue };
}
