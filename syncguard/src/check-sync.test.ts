import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PAGINATION_DEFAULT_CHECK } from "./checkDefinition.js";
import {
  aggregateCheckExitCode,
  DEFAULT_BASE_REF,
  formatCheckSyncOutput,
  parseCheckSyncArgs,
  resolveStreamPingOutputPath,
  runCheckSync,
  type CheckSyncDependencies,
} from "./check-sync.js";
import type { DetectResult } from "./detect.js";
import type { GitRunner } from "./git.js";
import type { AnalysisStatus, ConfigEnvEvidence, Evidence } from "./types.js";

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

function mockStreamPingEvidence(status: AnalysisStatus): ConfigEnvEvidence {
  return {
    schemaVersion: 1,
    checkId: "gotify-stream-ping-default",
    contractKind: "config-env-example",
    baseRef: "test-baseline",
    status,
    runtimeChange: {
      source: {
        file: "config/config.go",
        symbol: "Get",
        field: "PingPeriodSeconds",
      },
      baselineValue: 45,
      currentValue: 45,
    },
    documentation: {
      file: "gotify-server.env.example",
      envVariable: "GOTIFY_SERVER_STREAM_PINGPERIODSECONDS",
      documentedDefault: 45,
    },
  };
}

function mockPaginationResult(
  status: AnalysisStatus,
  artifactPath = join("/tmp", "deterministic-evidence.json"),
): DetectResult {
  const evidence: Evidence = {
    schemaVersion: 1,
    checkId: "gotify-pagination-default",
    baseRef: "test-baseline",
    status,
  };
  return {
    evidence,
    artifactPath,
    json: JSON.stringify(evidence),
    summary: `status: ${status}`,
    exitCode: 0,
  };
}

function suiteDeps(
  paginationStatus: AnalysisStatus,
  streamPingStatus: AnalysisStatus,
  options: {
    paginationArtifactPath?: string;
    streamPingArtifactPath?: string;
  } = {},
): CheckSyncDependencies {
  const written: { path: string; json: string }[] = [];
  return {
    detectPagination: () =>
      mockPaginationResult(
        paginationStatus,
        options.paginationArtifactPath ?? join("/tmp", "deterministic-evidence.json"),
      ),
    detectStreamPing: () => mockStreamPingEvidence(streamPingStatus),
    writeStreamPingArtifact: (path, json) => {
      written.push({ path, json });
    },
    ...options,
  };
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

describe("aggregateCheckExitCode", () => {
  it("returns 0 for synchronized and no_relevant_change combinations", () => {
    assert.equal(aggregateCheckExitCode(["synchronized", "no_relevant_change"]), 0);
    assert.equal(aggregateCheckExitCode(["synchronized", "synchronized"]), 0);
    assert.equal(aggregateCheckExitCode(["no_relevant_change", "no_relevant_change"]), 0);
  });

  it("returns 2 when any check is drift_detected and none are inconclusive", () => {
    assert.equal(aggregateCheckExitCode(["synchronized", "drift_detected"]), 2);
    assert.equal(aggregateCheckExitCode(["drift_detected", "no_relevant_change"]), 2);
  });

  it("returns 1 when any check is inconclusive, even with drift_detected", () => {
    assert.equal(aggregateCheckExitCode(["drift_detected", "inconclusive"]), 1);
    assert.equal(aggregateCheckExitCode(["inconclusive", "drift_detected"]), 1);
  });

  it("returns 1 when any check is inconclusive alone", () => {
    assert.equal(aggregateCheckExitCode(["synchronized", "inconclusive"]), 1);
  });
});

describe("resolveStreamPingOutputPath", () => {
  it("defaults to the check-declared artifact path relative to repo root", () => {
    const resolved = resolveStreamPingOutputPath("/repo", undefined);
    assert.equal(
      resolved,
      join("/repo", "syncguard/artifacts/deterministic-evidence-stream-ping.json"),
    );
  });
});

describe("runCheckSync suite", () => {
  it("returns exit 0 when pagination is synchronized and stream ping is no_relevant_change", () => {
    const result = runCheckSync({}, suiteDeps("synchronized", "no_relevant_change"));

    assert.equal(result.pagination.evidence.status, "synchronized");
    assert.equal(result.streamPing.evidence.status, "no_relevant_change");
    assert.equal(result.exitCode, 0);
    assert.match(formatCheckSyncOutput(result), /aggregate: pass \(exit=0\)/);
  });

  it("returns exit 2 when stream ping is drift_detected", () => {
    const result = runCheckSync({}, suiteDeps("synchronized", "drift_detected"));

    assert.equal(result.exitCode, 2);
    assert.match(formatCheckSyncOutput(result), /aggregate: fail \(exit=2\)/);
  });

  it("returns exit 2 when pagination is drift_detected", () => {
    const result = runCheckSync({}, suiteDeps("drift_detected", "no_relevant_change"));

    assert.equal(result.exitCode, 2);
    assert.match(formatCheckSyncOutput(result), /aggregate: fail \(exit=2\)/);
  });

  it("returns exit 1 when stream ping is inconclusive and pagination is drift_detected", () => {
    const result = runCheckSync({}, suiteDeps("drift_detected", "inconclusive"));

    assert.equal(result.exitCode, 1);
    assert.match(formatCheckSyncOutput(result), /aggregate: fail \(exit=1\)/);
  });

  it("returns exit 1 when pagination is inconclusive and stream ping is drift_detected", () => {
    const result = runCheckSync({}, suiteDeps("inconclusive", "drift_detected"));

    assert.equal(result.exitCode, 1);
    assert.match(formatCheckSyncOutput(result), /aggregate: fail \(exit=1\)/);
  });

  it("returns exit 0 for synchronized plus synchronized", () => {
    const result = runCheckSync({}, suiteDeps("synchronized", "synchronized"));
    assert.equal(result.exitCode, 0);
  });

  it("writes stream-ping artifact with config evidence shape", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "syncguard-check-sync-artifacts-"));
    const paginationPath = join(repoRoot, "syncguard/artifacts/deterministic-evidence.json");
    const streamPingPath = join(
      repoRoot,
      "syncguard/artifacts/deterministic-evidence-stream-ping.json",
    );
    const written: { path: string; json: string }[] = [];

    try {
      const result = runCheckSync(
        { repoRoot, streamPingOutputPath: streamPingPath },
        {
          detectPagination: () => mockPaginationResult("synchronized", paginationPath),
          detectStreamPing: () => mockStreamPingEvidence("no_relevant_change"),
          writeStreamPingArtifact: (path, json) => {
            written.push({ path, json });
          },
        },
      );

      assert.equal(result.pagination.artifactPath, paginationPath);
      assert.equal(result.streamPing.artifactPath, streamPingPath);
      assert.equal(written.length, 1);
      assert.equal(written[0]!.path, streamPingPath);

      const parsed = JSON.parse(written[0]!.json) as Record<string, unknown>;
      assert.equal(parsed.checkId, "gotify-stream-ping-default");
      assert.equal(parsed.contractKind, "config-env-example");
      assert.ok(parsed.documentation);
      assert.equal("affectedOperations" in parsed, false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("propagates unexpected detector errors as CLI failures", () => {
    assert.throws(
      () =>
        runCheckSync(
          {},
          {
            detectPagination: () => {
              throw new Error("pagination detector exploded");
            },
            detectStreamPing: () => mockStreamPingEvidence("no_relevant_change"),
          },
        ),
      /pagination detector exploded/,
    );
  });

  it("propagates unexpected writer errors as CLI failures", () => {
    assert.throws(
      () =>
        runCheckSync(
          {},
          {
            detectPagination: () => mockPaginationResult("synchronized"),
            detectStreamPing: () => mockStreamPingEvidence("no_relevant_change"),
            writeStreamPingArtifact: () => {
              throw new Error("writer exploded");
            },
          },
        ),
      /writer exploded/,
    );
  });
});

describe("runCheckSync pagination integration", () => {
  const streamPingPass: CheckSyncDependencies = {
    detectStreamPing: () => mockStreamPingEvidence("no_relevant_change"),
    writeStreamPingArtifact: () => {},
  };

  it("returns exit 0 for synchronized evidence", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "syncguard-check-sync-"));
    try {
      writeRepoFixtures(
        repoRoot,
        `${loadFixture("runtime-limit-50.go.txt")}\n${loadFixture("annotations-50.go.txt")}`,
        loadFixture("spec-50.json"),
      );

      const result = runCheckSync(
        {
          baseRef: "test-baseline",
          repoRoot,
          gitRunner: baselineGitRunner(loadFixture("runtime-limit-100.go.txt")),
        },
        streamPingPass,
      );

      assert.equal(result.pagination.evidence.status, "synchronized");
      assert.equal(result.exitCode, 0);
      assert.match(formatCheckSyncOutput(result), /gotify-pagination-default: synchronized/);
      assert.match(formatCheckSyncOutput(result), /aggregate: pass \(exit=0\)/);
      assert.match(result.pagination.summary, /^status: synchronized/m);
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

      const result = runCheckSync(
        {
          baseRef: "test-baseline",
          repoRoot,
          gitRunner: baselineGitRunner(loadFixture("runtime-limit-100.go.txt")),
        },
        streamPingPass,
      );

      assert.equal(result.pagination.evidence.status, "drift_detected");
      assert.equal(result.exitCode, 2);
      assert.match(formatCheckSyncOutput(result), /aggregate: fail \(exit=2\)/);
      assert.match(result.pagination.summary, /^status: drift_detected/m);
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

      const result = runCheckSync(
        {
          baseRef: "test-baseline",
          repoRoot,
          gitRunner: baselineGitRunner(loadFixture("runtime-limit-100.go.txt")),
        },
        streamPingPass,
      );

      assert.equal(result.pagination.evidence.status, "inconclusive");
      assert.equal(result.exitCode, 1);
      assert.match(formatCheckSyncOutput(result), /aggregate: fail \(exit=1\)/);
      assert.match(result.pagination.summary, /^status: inconclusive/m);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("uses the default base ref constant", () => {
    assert.equal(DEFAULT_BASE_REF, "demo-00-baseline");
  });
});
