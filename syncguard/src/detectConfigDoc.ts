/**
 * Repository-backed deterministic detector for config default vs env-example checks.
 *
 * Reads baseline runtime via Git, current runtime and documentation from the
 * working tree, invokes pure parsers and compareConfigDoc, and returns evidence.
 * Does not write artifacts, print output, choose exit codes, or call the SDK.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  STREAM_PING_DEFAULT_CHECK,
  type ConfigEnvDefaultCheck,
} from "./checkDefinition.js";
import { compareConfigDoc } from "./compareConfigDoc.js";
import { parseEnvExampleDefault } from "./envExampleSource.js";
import { findRepoRoot, gitShowFile, type GitRunner } from "./git.js";
import { parseRuntimeFieldDefault } from "./runtimeSource.js";
import type { ConfigEnvEvidence, ParseResult } from "./types.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SYNCGUARD_DIR = dirname(MODULE_DIR);

export type ReadFileFn = (absolutePath: string) => string;

export interface DetectConfigDocOptions {
  /** Check definition; defaults to STREAM_PING_DEFAULT_CHECK. */
  check?: ConfigEnvDefaultCheck;
  /** Git baseline ref; defaults to the check's baseRef. */
  baseRef?: string;
  /** Override repository root (tests only). */
  repoRoot?: string;
  /** Override git runner (tests only). */
  gitRunner?: GitRunner;
  /** Override working-tree file reader (tests only). */
  readFile?: ReadFileFn;
}

function defaultReadFile(absolutePath: string): string {
  return readFileSync(absolutePath, "utf8");
}

function readBaselineRuntimeSource(
  repoRoot: string,
  baseRef: string,
  relPath: string,
  gitRunner: GitRunner | undefined,
): ParseResult<string> {
  try {
    return { ok: true, value: gitShowFile(repoRoot, baseRef, relPath, gitRunner) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `Unable to read baseline runtime source ${baseRef}:${relPath}: ${detail}`,
    };
  }
}

function readWorkingTreeSource(
  repoRoot: string,
  relPath: string,
  readFile: ReadFileFn,
  failureLabel: string,
): ParseResult<string> {
  try {
    return { ok: true, value: readFile(join(repoRoot, relPath)) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `Unable to read ${failureLabel} ${relPath}: ${detail}`,
    };
  }
}

function parseRuntimeDefault(
  source: ParseResult<string>,
  target: ConfigEnvDefaultCheck["runtime"],
): ParseResult<number> {
  if (!source.ok) {
    return { ok: false, reason: source.reason };
  }
  const parsed = parseRuntimeFieldDefault(source.value, target);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  return { ok: true, value: parsed.value.value };
}

function parseDocumentedDefault(
  source: ParseResult<string>,
  envVariable: string,
): ParseResult<number> {
  if (!source.ok) {
    return { ok: false, reason: source.reason };
  }
  return parseEnvExampleDefault(source.value, envVariable);
}

/**
 * Run a config-env-example check against the repository working tree.
 * Defaults to {@link STREAM_PING_DEFAULT_CHECK}.
 */
export function detectConfigDocCheck(
  options: DetectConfigDocOptions = {},
): ConfigEnvEvidence {
  const check = options.check ?? STREAM_PING_DEFAULT_CHECK;
  const baseRef = options.baseRef ?? check.baseRef;
  const repoRoot = options.repoRoot ?? findRepoRoot(SYNCGUARD_DIR);
  const readFile = options.readFile ?? defaultReadFile;

  const baselineSource = readBaselineRuntimeSource(
    repoRoot,
    baseRef,
    check.runtime.file,
    options.gitRunner,
  );
  const currentRuntimeSource = readWorkingTreeSource(
    repoRoot,
    check.runtime.file,
    readFile,
    "current runtime source",
  );
  const documentationSource = readWorkingTreeSource(
    repoRoot,
    check.documentation.file,
    readFile,
    "documentation source",
  );

  const baselineRuntime = parseRuntimeDefault(baselineSource, check.runtime);
  const currentRuntime = parseRuntimeDefault(currentRuntimeSource, check.runtime);
  const documentedDefault = parseDocumentedDefault(
    documentationSource,
    check.documentation.envVariable,
  );

  return compareConfigDoc({
    checkId: check.checkId,
    baseRef,
    runtimeSource: {
      file: check.runtime.file,
      symbol: check.runtime.symbol,
      field: check.runtime.field,
    },
    documentationFile: check.documentation.file,
    envVariable: check.documentation.envVariable,
    baselineRuntime,
    currentRuntime,
    documentedDefault,
  });
}

/** Run the stream-ping default check. Alias for {@link detectConfigDocCheck}. */
export function detectStreamPingDefault(
  options: Omit<DetectConfigDocOptions, "check"> = {},
): ConfigEnvEvidence {
  return detectConfigDocCheck(options);
}
