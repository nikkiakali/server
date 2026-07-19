/**
 * Narrow parser for commented numeric defaults in Gotify env-example files.
 *
 * Recognizes exactly one line of the form `# VARNAME=<integer>` (optional
 * surrounding whitespace). Not a general .env parser.
 */
import type { ParseResult } from "./types.js";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the documented integer default for a named environment variable from
 * env-example source text.
 */
export function parseEnvExampleDefault(
  source: string,
  envVariable: string,
): ParseResult<number> {
  const pattern = new RegExp(
    `^\\s*#\\s*${escapeRegExp(envVariable)}=(\\d+)\\s*$`,
    "gm",
  );
  const matches = [...source.matchAll(pattern)];

  if (matches.length === 0) {
    return {
      ok: false,
      reason: `no commented integer assignment for ${envVariable}`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `ambiguous ${envVariable}: found ${matches.length} commented integer assignments`,
    };
  }

  return { ok: true, value: Number.parseInt(matches[0]![1]!, 10) };
}
