import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseArgs } from "./detect.js";
import { findRepoRoot, type GitRunner } from "./git.js";

describe("parseArgs", () => {
  it("requires --base-ref", () => {
    assert.throws(() => parseArgs([]), /--base-ref/);
  });

  it("parses --base-ref and --fail-on-drift", () => {
    const opts = parseArgs(["--base-ref", "demo-00-baseline", "--fail-on-drift"]);
    assert.equal(opts.baseRef, "demo-00-baseline");
    assert.equal(opts.failOnDrift, true);
  });
});

describe("findRepoRoot", () => {
  it("uses an argument array and returns the trimmed toplevel path", () => {
    const calls: string[][] = [];
    const run: GitRunner = (args, cwd) => {
      calls.push([...args]);
      assert.equal(cwd, "/start");
      return { status: 0, stdout: "/repo/root\n", stderr: "" };
    };
    assert.equal(findRepoRoot("/start", run), "/repo/root");
    assert.deepEqual(calls, [["rev-parse", "--show-toplevel"]]);
  });
});
