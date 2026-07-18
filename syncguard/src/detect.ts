/**
 * Phase 1 CLI: baseline-aware deterministic pagination drift detector.
 *
 * Discovers the Gotify repository root via git (from this module's directory),
 * reads baseline/current runtime sources, annotations, and docs/spec.json,
 * and writes syncguard/artifacts/deterministic-evidence.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAnnotationLimitDefault } from "./annotationSource.js";
import { compare, failOnDriftExitCode } from "./compare.js";
import { findRepoRoot, gitShowFile } from "./git.js";
import { formatSummary, serializeEvidence } from "./serialize.js";
import { parseSwaggerSpec, specLimitDefault } from "./spec.js";
import { parseWithPagingLimit } from "./runtimeSource.js";
import { AFFECTED_OPERATIONS, type Evidence } from "./types.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SYNCGUARD_DIR = dirname(MODULE_DIR);

const MESSAGE_GO = "api/message.go";
const SPEC_JSON = "docs/spec.json";
const ARTIFACT_REL = join("syncguard", "artifacts", "deterministic-evidence.json");

export interface DetectOptions {
  baseRef: string;
  failOnDrift: boolean;
  /** Override repository root (tests only). */
  repoRoot?: string;
}

export interface DetectResult {
  evidence: Evidence;
  artifactPath: string;
  json: string;
  summary: string;
  exitCode: number;
}

export function parseArgs(argv: string[]): DetectOptions {
  let baseRef: string | undefined;
  let failOnDrift = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--base-ref") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        throw new Error("--base-ref requires a value (e.g. demo-00-baseline)");
      }
      baseRef = value;
    } else if (arg === "--fail-on-drift") {
      failOnDrift = true;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(
        "usage: npm run detect-drift -- --base-ref <git-ref> [--fail-on-drift]",
      );
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!baseRef) {
    throw new Error(
      "missing required --base-ref <git-ref>\n" +
        "example: npm run detect-drift -- --base-ref demo-00-baseline",
    );
  }

  return { baseRef, failOnDrift };
}

export function runDetect(options: DetectOptions): DetectResult {
  const repoRoot = options.repoRoot ?? findRepoRoot(SYNCGUARD_DIR);
  const messageGoPath = join(repoRoot, MESSAGE_GO);
  const specPath = join(repoRoot, SPEC_JSON);
  const artifactPath = join(repoRoot, ARTIFACT_REL);

  const baselineGo = gitShowFile(repoRoot, options.baseRef, MESSAGE_GO);
  const currentGo = readFileSync(messageGoPath, "utf8");
  const specText = readFileSync(specPath, "utf8");

  const baselineRuntime = parseWithPagingLimit(baselineGo);
  const currentRuntime = parseWithPagingLimit(currentGo);

  const specParsed = parseSwaggerSpec(specText);

  const operations = AFFECTED_OPERATIONS.map((op) => ({
    ...op,
    annotationDefault: parseAnnotationLimitDefault(currentGo, op),
    generatedSpecDefault: specParsed.ok
      ? specLimitDefault(specParsed.value, op)
      : ({ ok: false as const, reason: specParsed.reason }),
  }));

  const evidence = compare({
    baseRef: options.baseRef,
    baselineRuntime,
    currentRuntime,
    operations,
  });

  const json = serializeEvidence(evidence);
  const summary = formatSummary(evidence);

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, json, "utf8");

  let exitCode = 0;
  if (options.failOnDrift) {
    exitCode = failOnDriftExitCode(evidence.status);
  } else if (evidence.status === "inconclusive") {
    exitCode = 1;
  }

  return { evidence, artifactPath, json, summary, exitCode };
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = runDetect(options);
    console.log(result.summary);
    console.log(`\nwrote ${result.artifactPath}`);
    process.exit(result.exitCode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main();
}
