import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PAGINATION_DEFAULT_CHECK } from "./checkDefinition.js";
import { parseRuntimeFieldDefault } from "./runtimeSource.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const TARGET = PAGINATION_DEFAULT_CHECK.runtimeSource;

function load(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("parseRuntimeFieldDefault", () => {
  it("extracts Limit: 50 from a single-line composite literal", () => {
    const result = parseRuntimeFieldDefault(load("runtime-limit-50.go.txt"), TARGET);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.value, 50);
      assert.equal(typeof result.value.line, "number");
    }
  });

  it("extracts Limit: 100 from a single-line composite literal", () => {
    const result = parseRuntimeFieldDefault(load("runtime-limit-100.go.txt"), TARGET);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.value, 100);
  });

  it("tolerates a multiline pagingParams composite literal", () => {
    const result = parseRuntimeFieldDefault(load("runtime-multiline.go.txt"), TARGET);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.value, 50);
  });

  it("returns inconclusive when Limit is missing", () => {
    const result = parseRuntimeFieldDefault(load("runtime-missing-limit.go.txt"), TARGET);
    assert.equal(result.ok, false);
  });

  it("returns inconclusive when withPaging is absent", () => {
    const result = parseRuntimeFieldDefault(load("runtime-no-withpaging.go.txt"), TARGET);
    assert.equal(result.ok, false);
  });

  it("uses check-declared symbol and field without hardcoded names in parser", () => {
    const goSource = `package api

func otherHelper() {}

func customFn(ctx *gin.Context) {
  params := &widgetType{PageSize: 41}
}
`;
    const result = parseRuntimeFieldDefault(goSource, {
      file: "ignored.go",
      symbol: "customFn",
      field: "PageSize",
      compositeLiteralType: "widgetType",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.value, 41);
  });
});
