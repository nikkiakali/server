/** Read-only git access. Argument arrays only — never shell command strings. */
import { spawnSync } from "node:child_process";

export interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], cwd: string) => GitResult;

const defaultRunner: GitRunner = (args, cwd) => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`failed to run git ${args.join(" ")}: ${result.error.message}`);
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

/**
 * Discover the repository root via `git rev-parse --show-toplevel`, starting
 * from an explicit directory (typically the module's own directory) so the
 * result does not depend on the caller's process.cwd().
 */
export function findRepoRoot(startDir: string, run: GitRunner = defaultRunner): string {
  const result = run(["rev-parse", "--show-toplevel"], startDir);
  if (result.status !== 0) {
    throw new Error(
      `git rev-parse --show-toplevel failed (exit ${result.status}): ${result.stderr.trim()}`,
    );
  }
  const root = result.stdout.trim();
  if (!root) {
    throw new Error("git rev-parse --show-toplevel returned an empty path");
  }
  return root;
}

/** Read a file's content at a git ref via `git show <ref>:<relPath>`. */
export function gitShowFile(
  repoRoot: string,
  ref: string,
  relPath: string,
  run: GitRunner = defaultRunner,
): string {
  const result = run(["show", `${ref}:${relPath}`], repoRoot);
  if (result.status !== 0) {
    throw new Error(
      `git show ${ref}:${relPath} failed (exit ${result.status}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}
