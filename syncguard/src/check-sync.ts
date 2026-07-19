/**
 * Phase 4C CI gate: run deterministic SyncGuard checks and fail on proven drift.
 *
 * Runs pagination and stream-ping configuration checks, writes separate evidence
 * artifacts, and aggregates exit codes. Never invokes the Cursor SDK.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { STREAM_PING_DEFAULT_CHECK } from "./checkDefinition.js";
import { detectConfigDocCheck } from "./detectConfigDoc.js";
import { runDetect, type DetectOptions, type DetectResult } from "./detect.js";
import { findRepoRoot } from "./git.js";
import {
  formatConfigEnvSummary,
  serializeConfigEnvEvidence,
} from "./serialize.js";
import type { AnalysisStatus, ConfigEnvEvidence } from "./types.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SYNCGUARD_DIR = dirname(MODULE_DIR);

/** Default git baseline ref for the CI gate when --base-ref is omitted. */
export const DEFAULT_BASE_REF = "demo-00-baseline";

export interface CheckSyncOptions {
  baseRef?: string;
  /** Pagination evidence output path (relative to repo root unless absolute). */
  outputPath?: string;
  /** Stream-ping evidence output path (relative to repo root unless absolute). */
  streamPingOutputPath?: string;
  repoRoot?: string;
  gitRunner?: DetectOptions["gitRunner"];
}

export interface StreamPingCheckResult {
  evidence: ConfigEnvEvidence;
  artifactPath: string;
  json: string;
  summary: string;
}

export interface CheckSyncResult {
  pagination: DetectResult;
  streamPing: StreamPingCheckResult;
  exitCode: number;
}

export type PaginationDetector = (options: DetectOptions) => DetectResult;
export type StreamPingDetector = (
  options: Parameters<typeof detectConfigDocCheck>[0],
) => ConfigEnvEvidence;
export type EvidenceWriter = (artifactPath: string, json: string) => void;

export interface CheckSyncDependencies {
  detectPagination?: PaginationDetector;
  detectStreamPing?: StreamPingDetector;
  writeStreamPingArtifact?: EvidenceWriter;
}

export function parseCheckSyncArgs(argv: string[]): CheckSyncOptions {
  let baseRef: string | undefined;
  let outputPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--base-ref") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        throw new Error("--base-ref requires a value (e.g. demo-00-baseline)");
      }
      baseRef = value;
    } else if (arg === "--output") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        throw new Error("--output requires a path");
      }
      outputPath = value;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(
        "usage: npm run check-sync -- [--base-ref <git-ref>] [--output <path>]\n" +
          `default base ref: ${DEFAULT_BASE_REF}`,
      );
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return { baseRef, outputPath };
}

export function resolveStreamPingOutputPath(
  repoRoot: string,
  outputPath: string | undefined,
): string {
  const relOrAbs = outputPath ?? STREAM_PING_DEFAULT_CHECK.defaultOutputRelPath;
  return isAbsolute(relOrAbs) ? relOrAbs : resolve(repoRoot, relOrAbs);
}

/** Aggregate suite exit code — inconclusive wins over drift_detected. */
export function aggregateCheckExitCode(statuses: AnalysisStatus[]): number {
  if (statuses.includes("inconclusive")) {
    return 1;
  }
  if (statuses.includes("drift_detected")) {
    return 2;
  }
  return 0;
}

function defaultWriteStreamPingArtifact(artifactPath: string, json: string): void {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, json, "utf8");
}

export function runCheckSync(
  options: CheckSyncOptions = {},
  dependencies: CheckSyncDependencies = {},
): CheckSyncResult {
  const baseRef = options.baseRef ?? DEFAULT_BASE_REF;
  const repoRoot = options.repoRoot ?? findRepoRoot(SYNCGUARD_DIR);
  const detectPagination = dependencies.detectPagination ?? runDetect;
  const detectStreamPing = dependencies.detectStreamPing ?? detectConfigDocCheck;
  const writeStreamPingArtifact =
    dependencies.writeStreamPingArtifact ?? defaultWriteStreamPingArtifact;

  const pagination = detectPagination({
    baseRef,
    failOnDrift: false,
    outputPath: options.outputPath,
    repoRoot,
    gitRunner: options.gitRunner,
  });

  const streamPingEvidence = detectStreamPing({
    baseRef,
    repoRoot,
    gitRunner: options.gitRunner,
  });

  const streamPingArtifactPath = resolveStreamPingOutputPath(
    repoRoot,
    options.streamPingOutputPath,
  );
  const streamPingJson = serializeConfigEnvEvidence(streamPingEvidence);
  const streamPingSummary = formatConfigEnvSummary(streamPingEvidence);
  writeStreamPingArtifact(streamPingArtifactPath, streamPingJson);

  const exitCode = aggregateCheckExitCode([
    pagination.evidence.status,
    streamPingEvidence.status,
  ]);

  return {
    pagination,
    streamPing: {
      evidence: streamPingEvidence,
      artifactPath: streamPingArtifactPath,
      json: streamPingJson,
      summary: streamPingSummary,
    },
    exitCode,
  };
}

export function formatCheckSyncOutput(result: CheckSyncResult): string {
  const aggregate = result.exitCode === 0 ? "pass" : "fail";
  return [
    `gotify-pagination-default: ${result.pagination.evidence.status}`,
    result.pagination.summary,
    "",
    `gotify-stream-ping-default: ${result.streamPing.evidence.status}`,
    result.streamPing.summary,
    "",
    `aggregate: ${aggregate} (exit=${result.exitCode})`,
    `\nwrote ${result.pagination.artifactPath}`,
    `wrote ${result.streamPing.artifactPath}`,
  ].join("\n");
}

function main(): void {
  try {
    const options = parseCheckSyncArgs(process.argv.slice(2));
    const result = runCheckSync(options);
    console.log(formatCheckSyncOutput(result));
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
