import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseAnnotationLimitDefault } from "./annotationSource.js";
import { AFFECTED_OPERATIONS } from "./types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const getMessages = AFFECTED_OPERATIONS.find((o) => o.operationId === "getMessages")!;
const getAppMessages = AFFECTED_OPERATIONS.find((o) => o.operationId === "getAppMessages")!;

function load(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("parseAnnotationLimitDefault", () => {
  it("extracts default 100 for both endpoints", () => {
    const src = load("annotations-100.go.txt");
    const msg = parseAnnotationLimitDefault(src, getMessages);
    const app = parseAnnotationLimitDefault(src, getAppMessages);
    assert.equal(msg.ok, true);
    assert.equal(app.ok, true);
    if (msg.ok) assert.equal(msg.value, 100);
    if (app.ok) assert.equal(app.value, 100);
  });

  it("extracts default 50 for both endpoints", () => {
    const src = load("annotations-50.go.txt");
    const msg = parseAnnotationLimitDefault(src, getMessages);
    const app = parseAnnotationLimitDefault(src, getAppMessages);
    assert.equal(msg.ok && msg.value, 50);
    assert.equal(app.ok && app.value, 50);
  });

  it("reports different defaults per endpoint without throwing", () => {
    const src = load("annotations-mixed.go.txt");
    const msg = parseAnnotationLimitDefault(src, getMessages);
    const app = parseAnnotationLimitDefault(src, getAppMessages);
    assert.equal(msg.ok && msg.value, 50);
    assert.equal(app.ok && app.value, 100);
  });

  it("returns inconclusive when annotation blocks are missing", () => {
    const src = load("annotations-missing.go.txt");
    const msg = parseAnnotationLimitDefault(src, getMessages);
    assert.equal(msg.ok, false);
  });
});
