/**
 * Phase 0 Cursor SDK preflight — isolated smoke test.
 * Does not implement SyncGuard detection or remediation.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNCGUARD_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(SYNCGUARD_ROOT, "..");

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

Optional: copy syncguard/.env.example to syncguard/.env for your own notes,
but this smoke test reads CURSOR_API_KEY from the process environment only
(it does not load .env files).

Re-run:

  cd syncguard && npm run sdk-smoke
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
    fail(
      "Could not resolve @cursor/sdk. Run: cd syncguard && npm install",
    );
  }

  // package.json is not in the package "exports" map; locate it from the resolved entry.
  let dir = dirname(sdkEntry);
  let sdkPkgPath: string | undefined;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
        name?: string;
        engines?: { node?: string };
        version?: string;
      };
      if (pkg.name === "@cursor/sdk") {
        sdkPkgPath = candidate;
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
              `Install a newer Node and re-run: cd syncguard && npm run sdk-smoke`,
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

  if (!sdkPkgPath) {
    fail("Could not locate installed @cursor/sdk package.json for engines check.");
  }
}

function gitPorcelain(cwd: string): string {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
  });
  if (result.error) {
    fail(`Failed to run git status: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(
      `git status failed (exit ${result.status}):\n${result.stderr || result.stdout}`,
    );
  }
  return (result.stdout ?? "").trimEnd();
}

function assertCleanWorkingTree(when: "before" | "after"): void {
  const porcelain = gitPorcelain(REPO_ROOT);
  if (porcelain.length === 0) {
    console.log(`Git working tree clean (${when} SDK run).`);
    return;
  }

  const paths = porcelain
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));

  if (when === "before") {
    fail(
      `Git working tree is not clean. Refusing to start the SDK agent.\n\n` +
        `Commit, stash, or otherwise clear these paths first:\n` +
        paths.map((p) => `  ${p}`).join("\n") +
        `\n\nThen re-run: cd syncguard && npm run sdk-smoke`,
    );
  }

  fail(
    `Git working tree changed during the SDK smoke run.\n` +
      `The agent appears to have created, edited, or deleted files.\n` +
      `Changed paths (left as-is; nothing was reset):\n` +
      paths.map((p) => `  ${p}`).join("\n"),
    3,
  );
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

async function main(): Promise<void> {
  assertNodeMeetsSdkEngines();
  const apiKey = requireCursorApiKey();
  assertCleanWorkingTree("before");

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

  const prompt =
    "Reply with exactly one concise sentence observing what this repository is " +
    "(for example its main language or purpose). " +
    "Do not create, edit, or delete any files. Do not run commands that change the working tree.";

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
            process.stdout.write(block.text);
          }
        }
      } else if (event.type === "tool_call") {
        console.log(`\n[tool_call:${event.name} status=${event.status}]`);
        if (/write|edit|delete/i.test(event.name)) {
          console.warn(
            `\nWarning: tool "${event.name}" may modify files; post-run git check will fail if the tree changes.`,
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

    console.log(`Run finished: status=${result.status}`);
    console.log(
      "Check the Cursor usage dashboard (SDK tag) for this run using the agentId/runId above.",
    );
  } catch (err) {
    if (err instanceof CursorAgentError) {
      fail(`SDK startup/runtime error: ${err.message}`);
    }
    throw err;
  }

  assertCleanWorkingTree("after");
  console.log("Phase 0 SDK smoke test passed.");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  fail(`Unhandled error: ${message}`);
});
