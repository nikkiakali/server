import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PAGINATION_DEFAULT_CHECK } from "./checkDefinition.js";
import { parseSwaggerSpec, specParameterDefault } from "./spec.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const CHECK = PAGINATION_DEFAULT_CHECK;
const getMessages = CHECK.operations.find((o) => o.operationId === "getMessages")!;
const getAppMessages = CHECK.operations.find((o) => o.operationId === "getAppMessages")!;

function load(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("specParameterDefault", () => {
  it("extracts default 100 for both endpoints", () => {
    const parsed = parseSwaggerSpec(load("spec-100.json"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const msg = specParameterDefault(parsed.value, getMessages, CHECK.parameterName);
    const app = specParameterDefault(parsed.value, getAppMessages, CHECK.parameterName);
    assert.equal(msg.ok && msg.value, 100);
    assert.equal(app.ok && app.value, 100);
  });

  it("extracts default 50 for both endpoints", () => {
    const parsed = parseSwaggerSpec(load("spec-50.json"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const msg = specParameterDefault(parsed.value, getMessages, CHECK.parameterName);
    const app = specParameterDefault(parsed.value, getAppMessages, CHECK.parameterName);
    assert.equal(msg.ok && msg.value, 50);
    assert.equal(app.ok && app.value, 50);
  });

  it("reports different defaults per endpoint without throwing", () => {
    const parsed = parseSwaggerSpec(load("spec-mixed.json"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const msg = specParameterDefault(parsed.value, getMessages, CHECK.parameterName);
    const app = specParameterDefault(parsed.value, getAppMessages, CHECK.parameterName);
    assert.equal(msg.ok && msg.value, 50);
    assert.equal(app.ok && app.value, 100);
  });

  it("rejects non-Swagger-2.0 documents", () => {
    const parsed = parseSwaggerSpec(load("spec-not-swagger2.json"));
    assert.equal(parsed.ok, false);
  });

  it("rejects invalid JSON", () => {
    const parsed = parseSwaggerSpec("{not json");
    assert.equal(parsed.ok, false);
  });
});
