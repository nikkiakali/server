/**
 * Phase 2 pure helpers: load deterministic evidence, build the Cursor SDK
 * analysis prompt, and validate the Markdown drift report.
 *
 * No network or SDK calls — scripts/sdk-analyze.ts is the live runner.
 */
import { readFileSync } from "node:fs";

import type { AnalysisStatus, Evidence, OperationResult, RuntimeChange } from "./types.js";
import { serializeEvidence } from "./serialize.js";

export class SdkAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SdkAnalysisError";
  }
}

export const REQUIRED_REPORT_HEADINGS = [
  "# SyncGuard Drift Report",
  "## Executive Summary",
  "## Proven Drift",
  "## Impact",
  "## Remediation Recommendation",
  "## Verification Steps",
  "## Runbook Update",
  "## Assumptions and Confidence",
] as const;

const ANALYSIS_STATUSES: ReadonlySet<string> = new Set([
  "no_relevant_change",
  "synchronized",
  "drift_detected",
  "inconclusive",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new SdkAnalysisError(`${ctx}: missing or invalid string field "${key}"`);
  }
  return value;
}

function expectNumber(obj: Record<string, unknown>, key: string, ctx: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SdkAnalysisError(`${ctx}: missing or invalid number field "${key}"`);
  }
  return value;
}

function expectStatus(value: unknown, ctx: string): AnalysisStatus {
  if (typeof value !== "string" || !ANALYSIS_STATUSES.has(value)) {
    throw new SdkAnalysisError(
      `${ctx}: invalid status "${String(value)}" (expected one of ${[...ANALYSIS_STATUSES].join(", ")})`,
    );
  }
  return value as AnalysisStatus;
}

function parseRuntimeChange(raw: unknown, ctx: string): RuntimeChange {
  if (!isRecord(raw)) {
    throw new SdkAnalysisError(`${ctx}: runtimeChange must be an object`);
  }
  if (!isRecord(raw.source)) {
    throw new SdkAnalysisError(`${ctx}: runtimeChange.source must be an object`);
  }
  const change: RuntimeChange = {
    source: {
      file: expectString(raw.source, "file", `${ctx}.source`),
      symbol: expectString(raw.source, "symbol", `${ctx}.source`),
      field: expectString(raw.source, "field", `${ctx}.source`),
    },
    baselineValue: expectNumber(raw, "baselineValue", ctx),
    currentValue: expectNumber(raw, "currentValue", ctx),
  };
  if (raw.baselineLine !== undefined) {
    change.baselineLine = expectNumber(raw, "baselineLine", ctx);
  }
  if (raw.currentLine !== undefined) {
    change.currentLine = expectNumber(raw, "currentLine", ctx);
  }
  return change;
}

function parseOperation(raw: unknown, ctx: string): OperationResult {
  if (!isRecord(raw)) {
    throw new SdkAnalysisError(`${ctx}: operation must be an object`);
  }
  const op: OperationResult = {
    operationId: expectString(raw, "operationId", ctx),
    method: expectString(raw, "method", ctx),
    path: expectString(raw, "path", ctx),
    runtimeDefault: expectNumber(raw, "runtimeDefault", ctx),
    status: expectStatus(raw.status, ctx),
  };
  if (raw.annotationDefault !== undefined) {
    op.annotationDefault = expectNumber(raw, "annotationDefault", ctx);
  }
  if (raw.generatedSpecDefault !== undefined) {
    op.generatedSpecDefault = expectNumber(raw, "generatedSpecDefault", ctx);
  }
  return op;
}

/** Parse and structurally validate Phase 1 deterministic evidence JSON text. */
export function parseEvidenceJson(text: string, sourceLabel = "evidence"): Evidence {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SdkAnalysisError(`${sourceLabel}: invalid JSON`);
  }
  if (!isRecord(parsed)) {
    throw new SdkAnalysisError(`${sourceLabel}: root value must be a JSON object`);
  }

  if (parsed.schemaVersion !== 1) {
    throw new SdkAnalysisError(
      `${sourceLabel}: unsupported schemaVersion ${String(parsed.schemaVersion)} (expected 1)`,
    );
  }
  if (parsed.checkId !== "gotify-pagination-default") {
    throw new SdkAnalysisError(
      `${sourceLabel}: unexpected checkId "${String(parsed.checkId)}" (expected gotify-pagination-default)`,
    );
  }

  const evidence: Evidence = {
    schemaVersion: 1,
    checkId: "gotify-pagination-default",
    baseRef: expectString(parsed, "baseRef", sourceLabel),
    status: expectStatus(parsed.status, sourceLabel),
  };

  if (parsed.reasons !== undefined) {
    if (!Array.isArray(parsed.reasons) || !parsed.reasons.every((r) => typeof r === "string")) {
      throw new SdkAnalysisError(`${sourceLabel}: reasons must be an array of strings`);
    }
    evidence.reasons = parsed.reasons as string[];
  }

  if (parsed.runtimeChange !== undefined) {
    evidence.runtimeChange = parseRuntimeChange(parsed.runtimeChange, `${sourceLabel}.runtimeChange`);
  }

  if (parsed.affectedOperations !== undefined) {
    if (!Array.isArray(parsed.affectedOperations)) {
      throw new SdkAnalysisError(`${sourceLabel}: affectedOperations must be an array`);
    }
    evidence.affectedOperations = parsed.affectedOperations.map((op, i) =>
      parseOperation(op, `${sourceLabel}.affectedOperations[${i}]`),
    );
  }

  return evidence;
}

/**
 * Ensure evidence contains a usable drift finding for SDK analysis.
 * Requires status drift_detected plus runtime and per-operation evidence.
 */
export function assertUsableDriftEvidence(evidence: Evidence, sourceLabel = "evidence"): void {
  if (evidence.status !== "drift_detected") {
    throw new SdkAnalysisError(
      `${sourceLabel}: no usable drift finding (status is "${evidence.status}", expected "drift_detected")`,
    );
  }
  if (!evidence.runtimeChange) {
    throw new SdkAnalysisError(
      `${sourceLabel}: no usable drift finding (missing runtimeChange)`,
    );
  }
  if (!evidence.affectedOperations?.length) {
    throw new SdkAnalysisError(
      `${sourceLabel}: no usable drift finding (missing affectedOperations)`,
    );
  }
  const drifted = evidence.affectedOperations.filter((op) => op.status === "drift_detected");
  if (drifted.length === 0) {
    throw new SdkAnalysisError(
      `${sourceLabel}: no usable drift finding (no affectedOperations with status drift_detected)`,
    );
  }
}

/** Load evidence from disk; validates structure and usable drift. */
export function loadDriftEvidence(filePath: string): Evidence {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SdkAnalysisError(`missing evidence file: ${filePath} (${detail})`);
  }
  const evidence = parseEvidenceJson(text, filePath);
  assertUsableDriftEvidence(evidence, filePath);
  return evidence;
}

/** Build the bounded analysis prompt embedding the evidence JSON. */
export function buildAnalysisPrompt(evidence: Evidence): string {
  const evidenceJson = serializeEvidence(evidence).trimEnd();
  const headingList = REQUIRED_REPORT_HEADINGS.map((h) => `- ${h}`).join("\n");

  return `You are SyncGuard's documentation-drift analyst.

## Authoritative evidence (JSON)

The following JSON is the authoritative source of repository facts for this task.
Treat every concrete path, endpoint, operationId, status, and numeric value in it as proven.
Do not guess repository facts. Do not claim files, values, endpoints, tests, or behavior not supported by this evidence.
If something is not present in the evidence, write exactly: unknown from supplied evidence.

\`\`\`json
${evidenceJson}
\`\`\`

## Hard rules

- Separate proven facts (from the JSON) from recommendations (your interpretation).
- Do not modify files.
- Do not execute remediation.
- Do not inspect unrelated repository files; rely on the supplied evidence.
- Do not run shell commands that change the working tree.
- Return Markdown only, without a surrounding code fence.
- Preserve exact paths, endpoints, and old/new values from the evidence.

## Required Markdown headings (use these exact headings, in this order)

${headingList}

## What each section must cover

- Executive Summary: one short paragraph stating that documentation drift was detected and naming the checkId / baseRef from the evidence.
- Proven Drift: what changed (baseline vs current runtime) and which annotation / generated-spec defaults are stale, per endpoint, using only evidence fields.
- Impact: why the mismatch matters for API consumers / docs accuracy, grounded in the affected operations.
- Remediation Recommendation: the safest remediation option, clearly marked as a recommendation (not a proven fact). Prefer aligning documentation with intentional runtime changes only when supported by the evidence story; otherwise recommend the safer path and say unknown from supplied evidence where intent is unclear.
- Verification Steps: concrete commands/checks a human can run after remediating (e.g. re-run SyncGuard detect-drift). Mark speculative steps as recommendations.
- Runbook Update: what should be added to an ops runbook about this class of drift (runtime default vs swagger annotations vs generated spec).
- Assumptions and Confidence: which statements are deterministic facts from the evidence versus SDK interpretation / assumptions.

Write the report now.`;
}

/** Strip a single optional outer markdown code fence wrapping the whole report. */
export function normalizeReportMarkdown(raw: string): string {
  let text = raw.replace(/^\uFEFF/, "").trim();
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced) {
    text = fenced[1]!.trim();
  }
  return text;
}

/** Validate the final Markdown report; throws SdkAnalysisError on failure. */
export function validateDriftReport(markdown: string): string {
  const report = normalizeReportMarkdown(markdown);
  if (!report) {
    throw new SdkAnalysisError("SDK report is empty");
  }

  const missing = REQUIRED_REPORT_HEADINGS.filter((heading) => {
    const pattern = new RegExp(`^${escapeRegExp(heading)}\\s*$`, "m");
    return !pattern.test(report);
  });
  if (missing.length > 0) {
    throw new SdkAnalysisError(
      `SDK report is missing required heading(s):\n${missing.map((h) => `  - ${h}`).join("\n")}`,
    );
  }

  // Enforce heading order for the main title and the ## sections.
  let cursor = 0;
  for (const heading of REQUIRED_REPORT_HEADINGS) {
    const idx = report.indexOf(heading, cursor);
    if (idx === -1) {
      throw new SdkAnalysisError(`SDK report is missing required heading: ${heading}`);
    }
    cursor = idx + heading.length;
  }

  return report.endsWith("\n") ? report : `${report}\n`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
