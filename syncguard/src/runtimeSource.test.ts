import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseWithPagingLimit } from "./runtimeSource.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function load(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("parseWithPagingLimit", () => {
  it("extracts Limit: 50 from a single-line composite literal", () => {
    const result = parseWithPagingLimit(load("runtime-limit-50.go.txt"));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.value, 50);
      assert.equal(typeof result.value.line, "number");
    }
  });

  it("extracts Limit: 100 from a single-line composite literal", () => {
    const result = parseWithPagingLimit(load("runtime-limit-100.go.txt"));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.value, 100);
  });

  it("tolerates a multiline pagingParams composite literal", () => {
    const result = parseWithPagingLimit(load("runtime-multiline.go.txt"));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.value, 50);
  });

  it("returns inconclusive when Limit is missing", () => {
    const result = parseWithPagingLimit(load("runtime-missing-limit.go.txt"));
    assert.equal(result.ok, false);
  });

  it("returns inconclusive when withPaging is absent", () => {
    const result = parseWithPagingLimit(load("runtime-no-withpaging.go.txt"));
    assert.equal(result.ok, false);
  });
});
