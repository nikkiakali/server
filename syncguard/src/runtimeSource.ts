/**
 * Gotify-specific runtime evidence parser.
 *
 * Extracts the numeric `Limit` default from the `pagingParams` composite
 * literal inside `func withPaging` in api/message.go. Deliberately narrow:
 * deterministic brace matching over the function body, tolerant of multiline
 * composite literals, but not a general Go parser.
 */
import type { ParseResult, RuntimeValue } from "./types.js";

function matchBrace(text: string, openIndex: number): number | undefined {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return undefined;
}

function lineOfIndex(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

export function parseWithPagingLimit(goSource: string): ParseResult<RuntimeValue> {
  const fnMatches = [...goSource.matchAll(/func\s+withPaging\s*\(/g)];
  if (fnMatches.length === 0) {
    return { ok: false, reason: "func withPaging not found" };
  }
  if (fnMatches.length > 1) {
    return { ok: false, reason: "multiple func withPaging definitions found" };
  }

  const fnStart = fnMatches[0]!.index!;
  const bodyOpen = goSource.indexOf("{", fnStart);
  if (bodyOpen === -1) {
    return { ok: false, reason: "func withPaging has no body" };
  }
  const bodyClose = matchBrace(goSource, bodyOpen);
  if (bodyClose === undefined) {
    return { ok: false, reason: "func withPaging body braces are unbalanced" };
  }
  const body = goSource.slice(bodyOpen, bodyClose + 1);

  // Composite literals only: `pagingParams{` or `&pagingParams{`.
  // Type references like `func(pagingParams *pagingParams)` have no `{`.
  const literalOpens = [...body.matchAll(/(?:&)?pagingParams\s*\{/g)].map(
    (m) => m.index! + m[0].length - 1,
  );
  if (literalOpens.length === 0) {
    return { ok: false, reason: "no pagingParams composite literal inside withPaging" };
  }

  const limits: Array<{ value: number; absoluteIndex: number }> = [];
  for (const open of literalOpens) {
    const close = matchBrace(body, open);
    if (close === undefined) {
      return { ok: false, reason: "pagingParams composite literal braces are unbalanced" };
    }
    const literal = body.slice(open, close + 1);
    for (const m of literal.matchAll(/(?:^|[\s,{])Limit\s*:\s*(\d+)/g)) {
      const digitsOffset = m.index! + m[0].indexOf(m[1]!);
      limits.push({
        value: Number.parseInt(m[1]!, 10),
        absoluteIndex: bodyOpen + open + digitsOffset,
      });
    }
  }

  if (limits.length === 0) {
    return {
      ok: false,
      reason: "no numeric Limit field in pagingParams literal inside withPaging",
    };
  }
  if (limits.length > 1) {
    return {
      ok: false,
      reason: `ambiguous Limit: found ${limits.length} numeric Limit fields inside withPaging`,
    };
  }

  const only = limits[0]!;
  return {
    ok: true,
    value: { value: only.value, line: lineOfIndex(goSource, only.absoluteIndex) },
  };
}
