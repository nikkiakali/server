import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { STREAM_PING_DEFAULT_CHECK } from "./checkDefinition.js";
import { detectConfigDocCheck } from "./detectConfigDoc.js";
import type { GitRunner } from "./git.js";

const CHECK = STREAM_PING_DEFAULT_CHECK;

function configGo(pingPeriodSeconds: number): string {
  return `package config

func Get() (*Configuration, []FutureLog) {
	c := &Configuration{
		Server: Server{
			Stream: Stream{
				PingPeriodSeconds: ${pingPeriodSeconds},
			},
		},
	}
	return c, nil
}
`;
}

function envExample(pingPeriodSeconds: number): string {
  return [
    "# Interval in seconds between WebSocket ping frames.",
    "# Type: number",
    `# ${CHECK.documentation.envVariable}=${pingPeriodSeconds}`,
  ].join("\n");
}

function writeFixtureRepo(
  repoRoot: string,
  currentRuntime: number,
  documented: number,
): void {
  const configPath = join(repoRoot, CHECK.runtime.file);
  const docPath = join(repoRoot, CHECK.documentation.file);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, configGo(currentRuntime), "utf8");
  writeFileSync(docPath, envExample(documented), "utf8");
}

function baselineGitRunner(baselineRuntime: number): GitRunner {
  return (args) => {
    if (args[0] === "show") {
      return { status: 0, stdout: configGo(baselineRuntime), stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected git invocation" };
  };
}

function failingGitRunner(message: string): GitRunner {
  return () => ({ status: 128, stdout: "", stderr: message });
}

describe("detectConfigDocCheck", () => {
  it("current synchronized baseline state → no_relevant_change at 45/45/45", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "syncguard-detect-config-"));
    try {
      writeFixtureRepo(repoRoot, 45, 45);

      const evidence = detectConfigDocCheck({
        repoRoot,
        gitRunner: baselineGitRunner(45),
      });

      assert.equal(evidence.checkId, "gotify-stream-ping-default");
      assert.equal(evidence.contractKind, "config-env-example");
      assert.equal(evidence.status, "no_relevant_change");
      assert.equal(evidence.runtimeChange.source.file, "config/config.go");
      assert.equal(evidence.runtimeChange.baselineValue, 45);
      assert.equal(evidence.runtimeChange.currentValue, 45);
      assert.equal(evidence.documentation.file, "gotify-server.env.example");
      assert.equal(
        evidence.documentation.envVariable,
        "GOTIFY_SERVER_STREAM_PINGPERIODSECONDS",
      );
      assert.equal(evidence.documentation.documentedDefault, 45);
      assert.equal("affectedOperations" in evidence, false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("runtime changed with stale documentation → drift_detected", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "syncguard-detect-config-"));
    try {
      writeFixtureRepo(repoRoot, 60, 45);

      const evidence = detectConfigDocCheck({
        repoRoot,
        gitRunner: baselineGitRunner(45),
      });

      assert.equal(evidence.status, "drift_detected");
      assert.equal(evidence.runtimeChange.baselineValue, 45);
      assert.equal(evidence.runtimeChange.currentValue, 60);
      assert.equal(evidence.documentation.documentedDefault, 45);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("runtime changed with updated documentation → synchronized", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "syncguard-detect-config-"));
    try {
      writeFixtureRepo(repoRoot, 60, 60);

      const evidence = detectConfigDocCheck({
        repoRoot,
        gitRunner: baselineGitRunner(45),
      });

      assert.equal(evidence.status, "synchronized");
      assert.equal(evidence.runtimeChange.currentValue, 60);
      assert.equal(evidence.documentation.documentedDefault, 60);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("baseline Git read fails → inconclusive", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "syncguard-detect-config-"));
    try {
      writeFixtureRepo(repoRoot, 45, 45);

      const evidence = detectConfigDocCheck({
        repoRoot,
        gitRunner: failingGitRunner("fatal: invalid object name 'missing-ref'"),
      });

      assert.equal(evidence.status, "inconclusive");
      assert.equal(evidence.runtimeChange.baselineValue, null);
      assert.equal(evidence.runtimeChange.currentValue, 45);
      assert.match(
        evidence.reasons?.[0] ?? "",
        /baseline runtime: Unable to read baseline runtime source/,
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("current runtime file read fails → inconclusive", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "syncguard-detect-config-"));
    try {
      writeFixtureRepo(repoRoot, 45, 45);

      const evidence = detectConfigDocCheck({
        repoRoot,
        gitRunner: baselineGitRunner(45),
        readFile: (path) => {
          if (path.endsWith(CHECK.runtime.file)) {
            throw new Error("ENOENT: no such file");
          }
          return envExample(45);
        },
      });

      assert.equal(evidence.status, "inconclusive");
      assert.equal(evidence.runtimeChange.baselineValue, 45);
      assert.equal(evidence.runtimeChange.currentValue, null);
      assert.match(
        evidence.reasons?.[0] ?? "",
        /current runtime: Unable to read current runtime source config\/config.go:/,
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("documentation read fails after runtime change → inconclusive", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "syncguard-detect-config-"));
    try {
      writeFixtureRepo(repoRoot, 60, 45);

      const evidence = detectConfigDocCheck({
        repoRoot,
        gitRunner: baselineGitRunner(45),
        readFile: (path) => {
          if (path.endsWith(CHECK.documentation.file)) {
            throw new Error("ENOENT: no such file");
          }
          return configGo(60);
        },
      });

      assert.equal(evidence.status, "inconclusive");
      assert.equal(evidence.runtimeChange.baselineValue, 45);
      assert.equal(evidence.runtimeChange.currentValue, 60);
      assert.equal(evidence.documentation.documentedDefault, null);
      assert.match(evidence.reasons?.[0] ?? "", /Runtime default changed from 45 to 60/);
      assert.match(
        evidence.reasons?.[1] ?? "",
        /documented default: Unable to read documentation source gotify-server.env.example:/,
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
