import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PAGINATION_DEFAULT_CHECK } from "./checkDefinition.js";
import {
  DEFAULT_BASE_REF,
  formatCheckSyncOutput,
  parseCheckSyncArgs,
  runCheckSync,
} from "./check-sync.js";
import type { GitRunner } from "./git.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const CHECK = PAGINATION_DEFAULT_CHECK;

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function baselineGitRunner(baselineGo: string): GitRunner {
  return (args) => {
    if (args[0] === "show") {
      return { status: 0, stdout: baselineGo, stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected git invocation" };
  };
}

function writeRepoFixtures(
  repoRoot: string,
  currentGo: string,
  specText: string,
): void {
  const runtimeRel = CHECK.runtimeSource.file;
  const specRel = CHECK.generatedSpecFile;
  mkdirSync(dirname(join(repoRoot, runtimeRel)), { recursive: true });
  mkdirSync(dirname(join(repoRoot, specRel)), { recursive: true });
  writeFileSync(join(repoRoot, runtimeRel), currentGo, "utf8");
  writeFileSync(join(repoRoot, specRel), specText, "utf8");
}

describe("parseCheckSyncArgs", () => {
  it("defaults base ref when omitted", () => {
    assert.deepEqual(parseCheckSyncArgs([]), { baseRef: undefined, outputPath: undefined });
  });

  it("parses optional --base-ref and --output", () => {
    const opts = parseCheckSyncArgs([
      "--base-ref",
      "release-v1",
      "--output",
      "syncguard/out/evidence.json",
    ]);
    assert.equal(opts.baseRef, "release-v1");
    assert.equal(opts.outputPath, "syncguard/out/evidence.json");
  });
});

describe("runCheckSync", () => {
  it("returns exit 0 for synchronized evidence", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "syncguard-check-sync-"));
    try {
      writeRepoFixtures(
        repoRoot,
        `${loadFixture("runtime-limit-50.go.txt")}\n${loadFixture("annotations-50.go.txt")}`,
        loadFixture("spec-50.json"),
      );

      const result = runCheckSync({
        baseRef: "test-baseline",
        repoRoot,
        gitRunner: baselineGitRunner(loadFixture("runtime-limit-100.go.txt")),
      });

      assert.equal(result.evidence.status, "synchronized");
      assert.equal(result.exitCode, 0);
      assert.match(formatCheckSyncOutput(result), /check-sync: pass \(status=synchronized, exit=0\)/);
      assert.match(result.summary, /^status: synchronized/m);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns exit 2 for drift_detected evidence", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "syncguard-check-sync-"));
    try {
      writeRepoFixtures(
        repoRoot,
        `${loadFixture("runtime-limit-50.go.txt")}\n${loadFixture("annotations-100.go.txt")}`,
        loadFixture("spec-100.json"),
      );

      const result = runCheckSync({
        baseRef: "test-baseline",
        repoRoot,
        gitRunner: baselineGitRunner(loadFixture("runtime-limit-100.go.txt")),
      });

      assert.equal(result.evidence.status, "drift_detected");
      assert.equal(result.exitCode, 2);
      assert.match(formatCheckSyncOutput(result), /check-sync: fail \(status=drift_detected, exit=2\)/);
      assert.match(result.summary, /^status: drift_detected/m);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns exit 1 for inconclusive evidence", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "syncguard-check-sync-"));
    try {
      writeRepoFixtures(
        repoRoot,
        `${loadFixture("runtime-missing-limit.go.txt")}\n${loadFixture("annotations-50.go.txt")}`,
        loadFixture("spec-50.json"),
      );

      const result = runCheckSync({
        baseRef: "test-baseline",
        repoRoot,
        gitRunner: baselineGitRunner(loadFixture("runtime-limit-100.go.txt")),
      });

      assert.equal(result.evidence.status, "inconclusive");
      assert.equal(result.exitCode, 1);
      assert.match(formatCheckSyncOutput(result), /check-sync: fail \(status=inconclusive, exit=1\)/);
      assert.match(result.summary, /^status: inconclusive/m);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("uses the default base ref constant", () => {
    assert.equal(DEFAULT_BASE_REF, "demo-00-baseline");
  });
});
