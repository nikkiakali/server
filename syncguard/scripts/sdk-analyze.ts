/**
 * Phase 2 live Cursor SDK runner.
 *
 * Validates deterministic evidence, asks a local plan-mode agent for a Markdown
 * drift report, validates required headings, and writes artifacts/sdk-drift-report.md.
 *
 * Reuses the working Phase 0 SDK patterns from scripts/sdk-smoke.ts
 * (auth, Node engines preflight, default-model selection, streaming, plan mode).
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SdkAnalysisError,
  buildAnalysisPrompt,
  loadAnalysisEvidence,
  validateDriftReport,
} from "../src/sdk-analysis.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNCGUARD_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(SYNCGUARD_ROOT, "..");

const DEFAULT_INPUT = "artifacts/deterministic-evidence.json";
const DEFAULT_OUTPUT = "artifacts/sdk-drift-report.md";

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function requireCursorApiKey(): string {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    fail(`CURSOR_API_KEY is not set.

Create a user or service-account API key:
  https://cursor.com/dashboard/integrations
(Cursor Dashboard → API Keys / Integrations)

Then export it in this shell (do not commit the key):

  export CURSOR_API_KEY=cursor_...

Re-run:

  cd syncguard && npm run sdk-analyze
`);
  }
  return apiKey;
}

function parseNodeVersion(version: string): [number, number, number] {
  const cleaned = version.replace(/^v/, "").split("-")[0] ?? "";
  const parts = cleaned.split(".").map((p) => Number.parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  if ([major, minor, patch].some((n) => Number.isNaN(n))) {
    fail(`Could not parse Node version: ${version}`);
  }
  return [major, minor, patch];
}

function compareSemver(
  a: [number, number, number],
  b: [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return 0;
}

/** Enforce the installed @cursor/sdk engines.node minimum (e.g. ">=22.13"). */
function assertNodeMeetsSdkEngines(): void {
  const require = createRequire(import.meta.url);
  let sdkEntry: string;
  try {
    sdkEntry = require.resolve("@cursor/sdk");
  } catch {
    fail("Could not resolve @cursor/sdk. Run: cd syncguard && npm install");
  }

  let dir = dirname(sdkEntry);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
        name?: string;
        engines?: { node?: string };
        version?: string;
      };
      if (pkg.name === "@cursor/sdk") {
        const enginesNode = pkg.engines?.node?.trim();
        if (!enginesNode) {
          console.warn(
            "Warning: @cursor/sdk has no engines.node field; skipping Node preflight.",
          );
          return;
        }
        const match = /^>=\s*(\d+(?:\.\d+){0,2})$/.exec(enginesNode);
        if (!match) {
          fail(
            `Unsupported @cursor/sdk engines.node format "${enginesNode}". Update the Phase 0 Node preflight.`,
          );
        }
        const minimum = parseNodeVersion(match[1]!);
        const current = parseNodeVersion(process.versions.node);
        if (compareSemver(current, minimum) < 0) {
          fail(
            `Node.js ${process.versions.node} is too old for @cursor/sdk@${pkg.version ?? "?"}.\n` +
              `This package requires Node ${enginesNode}.\n` +
              `Install a newer Node and re-run: cd syncguard && npm run sdk-analyze`,
          );
        }
        console.log(
          `Node preflight OK: v${process.versions.node} satisfies @cursor/sdk engines.node ${enginesNode}`,
        );
        return;
      }
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  fail("Could not locate installed @cursor/sdk package.json for engines check.");
}

type ModelListItem = {
  id: string;
  displayName?: string;
  variants?: Array<{
    params: Array<{ id: string; value: string }>;
    displayName: string;
    description?: string;
    isDefault?: boolean;
  }>;
};

type ModelSelection = {
  id: string;
  params?: Array<{ id: string; value: string }>;
};

function selectDefaultModel(models: ModelListItem[]): ModelSelection {
  const withDefaultVariant = models.find((m) =>
    m.variants?.some((v) => v.isDefault === true),
  );
  if (withDefaultVariant) {
    const variant = withDefaultVariant.variants!.find((v) => v.isDefault)!;
    return { id: withDefaultVariant.id, params: variant.params };
  }

  const ids = models.map((m) => `  ${m.id}`).join("\n");
  fail(
    `No SDK-designated default model was found (no model variant with isDefault).\n` +
      `Available model IDs:\n${ids || "  (none)"}\n\n` +
      `Set a default in your Cursor account / model settings, or update this smoke test once a default is available.`,
  );
}

function resolveSyncguardPath(pathArg: string): string {
  return isAbsolute(pathArg) ? pathArg : resolve(SYNCGUARD_ROOT, pathArg);
}

interface CliOptions {
  inputPath: string;
  outputPath: string;
}

function parseArgs(argv: string[]): CliOptions {
  let input = DEFAULT_INPUT;
  let output = DEFAULT_OUTPUT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--input") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        fail("--input requires a path");
      }
      input = value;
    } else if (arg === "--output") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        fail("--output requires a path");
      }
      output = value;
    } else if (arg === "--help" || arg === "-h") {
      fail(
        "usage: npm run sdk-analyze -- [--input <path>] [--output <path>]\n" +
          `defaults: --input ${DEFAULT_INPUT} --output ${DEFAULT_OUTPUT}`,
      );
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }

  return {
    inputPath: resolveSyncguardPath(input),
    outputPath: resolveSyncguardPath(output),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  console.log(`input:  ${options.inputPath}`);
  console.log(`output: ${options.outputPath}`);

  let evidence;
  try {
    evidence = loadAnalysisEvidence(options.inputPath);
  } catch (err) {
    if (err instanceof SdkAnalysisError) {
      fail(err.message);
    }
    throw err;
  }

  const prompt = buildAnalysisPrompt(evidence);
  assertNodeMeetsSdkEngines();
  const apiKey = requireCursorApiKey();

  const { Agent, Cursor, CursorAgentError } = await import("@cursor/sdk");

  let models: ModelListItem[];
  try {
    models = (await Cursor.models.list({ apiKey })) as ModelListItem[];
  } catch (err) {
    if (err instanceof CursorAgentError) {
      fail(`Failed to list models: ${err.message}`);
    }
    throw err;
  }
  if (!models.length) {
    fail("Cursor.models.list() returned no models for this API key.");
  }

  const model = selectDefaultModel(models);
  console.log(
    `Using SDK default model: ${model.id}` +
      (model.params?.length
        ? ` (params: ${model.params.map((p) => `${p.id}=${p.value}`).join(", ")})`
        : ""),
  );

  let assistantText = "";

  try {
    await using agent = await Agent.create({
      apiKey,
      model,
      mode: "plan",
      local: { cwd: REPO_ROOT },
    });

    console.log(`agentId: ${agent.agentId}`);

    const run = await agent.send(prompt, { model, mode: "plan" });
    console.log(`runId: ${run.id}`);
    console.log("--- agent stream ---");

    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text") {
            assistantText += block.text;
            process.stdout.write(block.text);
          }
        }
      } else if (event.type === "tool_call") {
        console.log(`\n[tool_call:${event.name} status=${event.status}]`);
        if (/write|edit|delete/i.test(event.name)) {
          console.warn(
            `\nWarning: tool "${event.name}" may modify files; analysis must remain read-only.`,
          );
        }
      }
    }

    process.stdout.write("\n--- end stream ---\n");

    const result = await run.wait();
    if (result.status === "error") {
      fail(
        `SDK run failed (status=error)` +
          (result.error?.message ? `: ${result.error.message}` : "") +
          `\nagentId=${agent.agentId} runId=${result.id}`,
        2,
      );
    }

    // Prefer streamed assistant text; fall back to wait() result text if needed.
    if (!assistantText.trim() && typeof result.result === "string") {
      assistantText = result.result;
    }

    console.log(`Run finished: status=${result.status}`);
  } catch (err) {
    if (err instanceof CursorAgentError) {
      fail(`SDK startup/runtime error: ${err.message}`);
    }
    throw err;
  }

  let report: string;
  try {
    report = validateDriftReport(assistantText);
  } catch (err) {
    if (err instanceof SdkAnalysisError) {
      fail(err.message);
    }
    throw err;
  }

  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, report, "utf8");
  console.log(`wrote ${options.outputPath}`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  fail(`Unhandled error: ${message}`);
});
