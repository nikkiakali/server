/**
 * Phase 4A CI gate: run the deterministic detector and fail on proven drift.
 *
 * Thin wrapper around runDetect — no duplicated parsing or comparison logic.
 * Never invokes the Cursor SDK or makes network requests.
 */
import { fileURLToPath } from "node:url";

import { runDetect, type DetectOptions, type DetectResult } from "./detect.js";

/** Default git baseline ref for the CI gate when --base-ref is omitted. */
export const DEFAULT_BASE_REF = "demo-00-baseline";

export interface CheckSyncOptions {
  baseRef?: string;
  outputPath?: string;
  repoRoot?: string;
  gitRunner?: DetectOptions["gitRunner"];
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

export function runCheckSync(options: CheckSyncOptions = {}): DetectResult {
  return runDetect({
    baseRef: options.baseRef ?? DEFAULT_BASE_REF,
    failOnDrift: true,
    outputPath: options.outputPath,
    repoRoot: options.repoRoot,
    gitRunner: options.gitRunner,
  });
}

export function formatCheckSyncOutput(result: DetectResult): string {
  const outcome = result.exitCode === 0 ? "pass" : "fail";
  return [
    `check-sync: ${outcome} (status=${result.evidence.status}, exit=${result.exitCode})`,
    result.summary,
    `\nwrote ${result.artifactPath}`,
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
