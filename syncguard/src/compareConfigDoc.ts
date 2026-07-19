/**
 * Pure status derivation for configuration default vs env-example documentation.
 *
 * Compares baseline/current runtime values against a documented env-example
 * default. Does not read files, invoke Git, or call the SDK.
 *
 * Top-level precedence:
 * 1. Baseline or current runtime unparsable → inconclusive
 * 2. Baseline runtime equals current runtime → no_relevant_change
 * 3. Runtime changed and documented default unparsable → inconclusive
 * 4. Runtime changed and documented default differs from current → drift_detected
 * 5. Otherwise → synchronized
 */
import type {
  ConfigDocCompareInput,
  ConfigEnvEvidence,
  ConfigRuntimeChange,
} from "./types.js";

function buildRuntimeChange(input: ConfigDocCompareInput): ConfigRuntimeChange {
  return {
    source: input.runtimeSource,
    baselineValue: input.baselineRuntime.ok ? input.baselineRuntime.value : null,
    currentValue: input.currentRuntime.ok ? input.currentRuntime.value : null,
  };
}

export function compareConfigDoc(input: ConfigDocCompareInput): ConfigEnvEvidence {
  const runtimeChange = buildRuntimeChange(input);
  const documentation = {
    file: input.documentationFile,
    envVariable: input.envVariable,
    documentedDefault: input.documentedDefault.ok ? input.documentedDefault.value : null,
  };

  const base: ConfigEnvEvidence = {
    schemaVersion: 1,
    checkId: input.checkId,
    contractKind: "config-env-example",
    baseRef: input.baseRef,
    status: "inconclusive",
    runtimeChange,
    documentation,
  };

  if (!input.baselineRuntime.ok || !input.currentRuntime.ok) {
    const reasons: string[] = [];
    if (!input.baselineRuntime.ok) {
      reasons.push(`baseline runtime: ${input.baselineRuntime.reason}`);
    }
    if (!input.currentRuntime.ok) {
      reasons.push(`current runtime: ${input.currentRuntime.reason}`);
    }
    return { ...base, reasons };
  }

  const baseline = input.baselineRuntime.value;
  const current = input.currentRuntime.value;
  const resolvedRuntimeChange: ConfigRuntimeChange = {
    ...runtimeChange,
    baselineValue: baseline,
    currentValue: current,
  };

  if (baseline === current) {
    return {
      ...base,
      status: "no_relevant_change",
      runtimeChange: resolvedRuntimeChange,
    };
  }

  const changeReason = `Runtime default changed from ${baseline} to ${current}.`;

  if (!input.documentedDefault.ok) {
    return {
      ...base,
      runtimeChange: resolvedRuntimeChange,
      reasons: [
        changeReason,
        `documented default: ${input.documentedDefault.reason}`,
      ],
    };
  }

  const documented = input.documentedDefault.value;
  const resolvedDocumentation = {
    ...documentation,
    documentedDefault: documented,
  };

  if (documented !== current) {
    return {
      ...base,
      status: "drift_detected",
      runtimeChange: resolvedRuntimeChange,
      documentation: resolvedDocumentation,
      reasons: [
        changeReason,
        `Documented default ${documented} does not match current runtime default ${current}.`,
      ],
    };
  }

  return {
    ...base,
    status: "synchronized",
    runtimeChange: resolvedRuntimeChange,
    documentation: resolvedDocumentation,
    reasons: [
      changeReason,
      `Documented default ${documented} matches current runtime default ${current}.`,
    ],
  };
}
