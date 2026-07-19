import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PAGINATION_DEFAULT_CHECK } from "./checkDefinition.js";
import { parseArgs, resolveOutputPath, runDetect } from "./detect.js";
import { findRepoRoot, type GitRunner } from "./git.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const CHECK = PAGINATION_DEFAULT_CHECK;

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("parseArgs", () => {
  it("requires --base-ref", () => {
    assert.throws(() => parseArgs([]), /--base-ref/);
  });

  it("parses --base-ref and --fail-on-drift", () => {
    const opts = parseArgs(["--base-ref", "demo-00-baseline", "--fail-on-drift"]);
    assert.equal(opts.baseRef, "demo-00-baseline");
    assert.equal(opts.failOnDrift, true);
    assert.equal(opts.outputPath, undefined);
  });

  it("parses generic --output path", () => {
    const opts = parseArgs([
      "--base-ref",
      "demo-00-baseline",
      "--output",
      "syncguard/artifacts/custom-evidence.json",
    ]);
    assert.equal(opts.baseRef, "demo-00-baseline");
    assert.equal(opts.outputPath, "syncguard/artifacts/custom-evidence.json");
  });

  it("rejects --output without a value", () => {
    assert.throws(() => parseArgs(["--base-ref", "x", "--output"]), /--output requires a path/);
  });
});

describe("check definition", () => {
  it("declares runtime source and generated spec without numeric defaults", () => {
    assert.equal(CHECK.checkId, "gotify-pagination-default");
    assert.equal(CHECK.runtimeSource.file, "api/message.go");
    assert.equal(CHECK.generatedSpecFile, "docs/spec.json");
    assert.equal(CHECK.parameterName, "limit");
    assert.equal(CHECK.runtimeSource.compositeLiteralType, "pagingParams");
    assert.ok(CHECK.operations.length >= 2);
  });
});

describe("resolveOutputPath", () => {
  it("defaults to the check-declared artifact path relative to repo root", () => {
    const resolved = resolveOutputPath("/repo", undefined);
    assert.equal(resolved, join("/repo", CHECK.defaultOutputRelPath));
  });

  it("resolves relative --output paths from the repository root", () => {
    const resolved = resolveOutputPath("/repo", "syncguard/out/custom.json");
    assert.equal(resolved, join("/repo", "syncguard/out/custom.json"));
  });

  it("uses absolute --output paths as-is", () => {
    const resolved = resolveOutputPath("/repo", "/tmp/evidence.json");
    assert.equal(resolved, "/tmp/evidence.json");
  });
});

describe("runDetect output", () => {
  it("creates arbitrary parent directories for --output", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "syncguard-detect-"));
    try {
      const runtimeRel = CHECK.runtimeSource.file;
      const specRel = CHECK.generatedSpecFile;
      mkdirSync(dirname(join(repoRoot, runtimeRel)), { recursive: true });
      mkdirSync(dirname(join(repoRoot, specRel)), { recursive: true });

      const currentGo = `${loadFixture("runtime-limit-50.go.txt")}\n${loadFixture("annotations-100.go.txt")}`;
      writeFileSync(join(repoRoot, runtimeRel), currentGo, "utf8");
      writeFileSync(join(repoRoot, specRel), loadFixture("spec-100.json"), "utf8");

      const baselineGo = loadFixture("runtime-limit-100.go.txt");
      const gitRunner: GitRunner = (args) => {
        if (args[0] === "show") {
          return { status: 0, stdout: baselineGo, stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "unexpected git invocation" };
      };

      const outputRel = "syncguard/tmp/nested/parent/evidence.json";
      const result = runDetect({
        baseRef: "test-baseline",
        failOnDrift: false,
        outputPath: outputRel,
        repoRoot,
        gitRunner,
      });

      assert.equal(result.artifactPath, join(repoRoot, outputRel));
      assert.ok(existsSync(result.artifactPath));
      assert.equal(readFileSync(result.artifactPath, "utf8"), result.json);
      assert.equal(result.evidence.status, "drift_detected");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
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
