/**
 * Phase 1 CLI: baseline-aware deterministic pagination drift detector.
 *
 * Discovers the Gotify repository root via git (from this module's directory),
 * reads baseline/current runtime sources, annotations, and the generated spec,
 * and writes SyncGuard evidence JSON.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAnnotationParameterDefault } from "./annotationSource.js";
import { PAGINATION_DEFAULT_CHECK } from "./checkDefinition.js";
import { compare, failOnDriftExitCode } from "./compare.js";
import { findRepoRoot, gitShowFile, type GitRunner } from "./git.js";
import { formatSummary, serializeEvidence } from "./serialize.js";
import { parseSwaggerSpec, specParameterDefault } from "./spec.js";
import { parseRuntimeFieldDefault } from "./runtimeSource.js";
import type { Evidence } from "./types.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SYNCGUARD_DIR = dirname(MODULE_DIR);

const CHECK = PAGINATION_DEFAULT_CHECK;

export interface DetectOptions {
  baseRef: string;
  failOnDrift: boolean;
  /**
   * Evidence output path. Absolute paths are used as-is; relative paths are
   * resolved from the repository root (not process.cwd()).
   */
  outputPath?: string;
  /** Override repository root (tests only). */
  repoRoot?: string;
  /** Override git runner (tests only). */
  gitRunner?: GitRunner;
}

export interface DetectResult {
  evidence: Evidence;
  artifactPath: string;
  json: string;
  summary: string;
  exitCode: number;
}

export function resolveOutputPath(repoRoot: string, outputPath: string | undefined): string {
  const relOrAbs = outputPath ?? CHECK.defaultOutputRelPath;
  return isAbsolute(relOrAbs) ? relOrAbs : resolve(repoRoot, relOrAbs);
}

export function parseArgs(argv: string[]): DetectOptions {
  let baseRef: string | undefined;
  let failOnDrift = false;
  let outputPath: string | undefined;

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
    } else if (arg === "--output") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        throw new Error("--output requires a path");
      }
      outputPath = value;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(
        "usage: npm run detect-drift -- --base-ref <git-ref> [--output <path>] [--fail-on-drift]",
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

  return { baseRef, failOnDrift, outputPath };
}

export function runDetect(options: DetectOptions): DetectResult {
  const repoRoot = options.repoRoot ?? findRepoRoot(SYNCGUARD_DIR);
  const runtimeFile = CHECK.runtimeSource.file;
  const messageGoPath = join(repoRoot, runtimeFile);
  const specPath = join(repoRoot, CHECK.generatedSpecFile);
  const artifactPath = resolveOutputPath(repoRoot, options.outputPath);

  const gitRun = options.gitRunner;
  const baselineGo = gitShowFile(repoRoot, options.baseRef, runtimeFile, gitRun);
  const currentGo = readFileSync(messageGoPath, "utf8");
  const specText = readFileSync(specPath, "utf8");

  const baselineParsed = parseRuntimeFieldDefault(baselineGo, CHECK.runtimeSource);
  const currentParsed = parseRuntimeFieldDefault(currentGo, CHECK.runtimeSource);
  const specParsed = parseSwaggerSpec(specText);

  const operations = CHECK.operations.map((op) => ({
    ...op,
    annotationDefault: parseAnnotationParameterDefault(
      currentGo,
      op,
      CHECK.parameterName,
    ),
    generatedSpecDefault: specParsed.ok
      ? specParameterDefault(specParsed.value, op, CHECK.parameterName)
      : ({ ok: false as const, reason: specParsed.reason }),
  }));

  const evidence = compare({
    checkId: CHECK.checkId,
    baseRef: options.baseRef,
    runtimeSource: CHECK.runtimeSource,
    baselineRuntime: baselineParsed,
    currentRuntime: currentParsed,
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
