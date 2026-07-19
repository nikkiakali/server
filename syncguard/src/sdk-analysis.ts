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

/** Status values the Cursor SDK analysis workflow accepts. */
export const SDK_ANALYSIS_STATUSES: ReadonlySet<AnalysisStatus> = new Set([
  "drift_detected",
  "synchronized",
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
  const evidence: Evidence = {
    schemaVersion: 1,
    checkId: expectString(parsed, "checkId", sourceLabel),
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

function assertRuntimeAndOperationsPresent(
  evidence: Evidence,
  sourceLabel: string,
): asserts evidence is Evidence & {
  runtimeChange: RuntimeChange;
  affectedOperations: OperationResult[];
} {
  if (!evidence.runtimeChange) {
    throw new SdkAnalysisError(
      `${sourceLabel}: unusable evidence (missing runtimeChange)`,
    );
  }
  if (!evidence.affectedOperations?.length) {
    throw new SdkAnalysisError(
      `${sourceLabel}: unusable evidence (missing affectedOperations)`,
    );
  }
}

/**
 * Ensure evidence is structurally complete and usable for SDK analysis.
 * Accepts `drift_detected` (at least one drifted operation) or `synchronized`
 * (all affected operations synchronized with matching runtime/annotation/spec values).
 */
export function assertUsableAnalysisEvidence(
  evidence: Evidence,
  sourceLabel = "evidence",
): void {
  if (!SDK_ANALYSIS_STATUSES.has(evidence.status)) {
    throw new SdkAnalysisError(
      `${sourceLabel}: unsupported evidence status "${evidence.status}" (expected "drift_detected" or "synchronized")`,
    );
  }

  assertRuntimeAndOperationsPresent(evidence, sourceLabel);
  const { runtimeChange, affectedOperations } = evidence;

  if (evidence.status === "drift_detected") {
    const drifted = affectedOperations.filter((op) => op.status === "drift_detected");
    if (drifted.length === 0) {
      throw new SdkAnalysisError(
        `${sourceLabel}: unusable drift evidence (no affectedOperations with status drift_detected)`,
      );
    }
    return;
  }

  for (const op of affectedOperations) {
    if (op.status !== "synchronized") {
      throw new SdkAnalysisError(
        `${sourceLabel}: unusable synchronized evidence (operation "${op.operationId}" status is "${op.status}", expected "synchronized")`,
      );
    }
    if (op.annotationDefault === undefined) {
      throw new SdkAnalysisError(
        `${sourceLabel}: unusable synchronized evidence (operation "${op.operationId}" missing annotationDefault)`,
      );
    }
    if (op.generatedSpecDefault === undefined) {
      throw new SdkAnalysisError(
        `${sourceLabel}: unusable synchronized evidence (operation "${op.operationId}" missing generatedSpecDefault)`,
      );
    }
    if (
      op.runtimeDefault !== runtimeChange.currentValue ||
      op.annotationDefault !== runtimeChange.currentValue ||
      op.generatedSpecDefault !== runtimeChange.currentValue
    ) {
      throw new SdkAnalysisError(
        `${sourceLabel}: unusable synchronized evidence (operation "${op.operationId}" defaults must all equal runtimeChange.currentValue)`,
      );
    }
  }
}

/**
 * @deprecated Prefer {@link assertUsableAnalysisEvidence}. Kept for drift-only call sites.
 */
export function assertUsableDriftEvidence(evidence: Evidence, sourceLabel = "evidence"): void {
  if (evidence.status !== "drift_detected") {
    throw new SdkAnalysisError(
      `${sourceLabel}: no usable drift finding (status is "${evidence.status}", expected "drift_detected")`,
    );
  }
  assertUsableAnalysisEvidence(evidence, sourceLabel);
}

/** Load evidence from disk; validates structure and SDK-usable status. */
export function loadAnalysisEvidence(filePath: string): Evidence {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SdkAnalysisError(`missing evidence file: ${filePath} (${detail})`);
  }
  const evidence = parseEvidenceJson(text, filePath);
  assertUsableAnalysisEvidence(evidence, filePath);
  return evidence;
}

/** @deprecated Prefer {@link loadAnalysisEvidence}. */
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

function buildDriftSectionInstructions(): string {
  return `- Executive Summary: one short paragraph stating that documentation drift was detected and naming the checkId / baseRef from the evidence.
- Proven Drift: what changed (baseline vs current runtime) and which annotation / generated-spec defaults are stale, per endpoint, using only evidence fields.
- Impact: why the mismatch matters for API consumers / docs accuracy, grounded in the affected operations.
- Remediation Recommendation: the safest remediation option, clearly marked as a recommendation (not a proven fact). Prefer aligning documentation with intentional runtime changes only when supported by the evidence story; otherwise recommend the safer path and say unknown from supplied evidence where intent is unclear. Do not state that remediation is already complete.
- Verification Steps: concrete commands/checks a human can run after remediating (e.g. re-run SyncGuard detect-drift). Mark speculative steps as recommendations.
- Runbook Update: what should be added to an ops runbook about this class of drift (runtime default vs swagger annotations vs generated spec).
- Assumptions and Confidence: which statements are deterministic facts from the evidence versus SDK interpretation / assumptions.`;
}

function buildSynchronizedSectionInstructions(): string {
  return `- Executive Summary: one short paragraph stating that the targeted documentation drift is resolved (status synchronized) and naming the checkId / baseRef from the evidence. Do not claim unresolved drift remains for the affected operations in the evidence.
- Proven Drift: describe the historical runtime change (baseline vs current from runtimeChange) and, per affected operation in the evidence, state that runtimeDefault, annotationDefault, and generatedSpecDefault now match. Do not describe annotation or generated-spec defaults as stale. Scope this section strictly to the operations listed in the evidence.
- Impact: explain why keeping runtime, swagger annotations, and generated spec aligned matters for API consumers, grounded only in the affected operations from the evidence. Do not claim impact from tests or other repository areas not present in the evidence.
- Remediation Recommendation: state clearly that no further remediation is required for this synchronized check. Do not recommend updating swagger annotations, regenerating the spec, or changing runtime for the affected operations. You may note ongoing maintenance expectations as recommendations only.
- Verification Steps: recommend re-running SyncGuard detect-drift (or equivalent) to confirm the check stays synchronized. Do not recommend remediation steps for checks already synchronized in the evidence.
- Runbook Update: what ops should record about verified synchronization for this drift class (runtime default vs swagger annotations vs generated spec). Mention that future runtime changes require re-checking alignment.
- Assumptions and Confidence: which statements are deterministic facts from the evidence versus SDK interpretation / assumptions. Do not claim that every pagination-related test or repository reference was checked or synchronized. Do not treat api/message_test.go or other files not listed in the evidence as verified.`;
}

/** Build the bounded analysis prompt embedding the evidence JSON. */
export function buildAnalysisPrompt(evidence: Evidence): string {
  const evidenceJson = serializeEvidence(evidence).trimEnd();
  const headingList = REQUIRED_REPORT_HEADINGS.map((h) => `- ${h}`).join("\n");
  const sectionInstructions =
    evidence.status === "synchronized"
      ? buildSynchronizedSectionInstructions()
      : buildDriftSectionInstructions();
  const taskLabel =
    evidence.status === "synchronized"
      ? "post-remediation verification / closure"
      : "open drift analysis";

  return `You are SyncGuard's documentation-drift analyst.

## Task

Produce a ${taskLabel} report based solely on the deterministic evidence below.

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
- Do not assume numeric defaults beyond those explicitly present in the evidence.

## Required Markdown headings (use these exact headings, in this order)

${headingList}

## What each section must cover

${sectionInstructions}

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
