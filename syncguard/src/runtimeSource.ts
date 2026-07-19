/**
 * Go runtime evidence parser for a named function symbol and struct field.
 *
 * Extracts a numeric field default from a composite literal inside the
 * configured function body. Deliberately narrow: deterministic brace matching,
 * tolerant of multiline composite literals, but not a general Go parser.
 *
 * Symbol, field, and composite literal type are supplied by the check
 * definition at the call site.
 */
import type { RuntimeSourceRef } from "./types.js";
import type { ParseResult, RuntimeValue } from "./types.js";

export interface RuntimeParseTarget extends RuntimeSourceRef {
  compositeLiteralType: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

export function parseRuntimeFieldDefault(
  goSource: string,
  target: RuntimeParseTarget,
): ParseResult<RuntimeValue> {
  const { symbol, field, compositeLiteralType } = target;
  const fnPattern = new RegExp(`func\\s+${escapeRegExp(symbol)}\\s*\\(`, "g");
  const fnMatches = [...goSource.matchAll(fnPattern)];
  if (fnMatches.length === 0) {
    return { ok: false, reason: `func ${symbol} not found` };
  }
  if (fnMatches.length > 1) {
    return { ok: false, reason: `multiple func ${symbol} definitions found` };
  }

  const fnStart = fnMatches[0]!.index!;
  const bodyOpen = goSource.indexOf("{", fnStart);
  if (bodyOpen === -1) {
    return { ok: false, reason: `func ${symbol} has no body` };
  }
  const bodyClose = matchBrace(goSource, bodyOpen);
  if (bodyClose === undefined) {
    return { ok: false, reason: `func ${symbol} body braces are unbalanced` };
  }
  const body = goSource.slice(bodyOpen, bodyClose + 1);

  const literalType = escapeRegExp(compositeLiteralType);
  const literalOpens = [
    ...body.matchAll(new RegExp(`(?:&)?${literalType}\\s*\\{`, "g")),
  ].map((m) => m.index! + m[0].length - 1);
  if (literalOpens.length === 0) {
    return {
      ok: false,
      reason: `no ${compositeLiteralType} composite literal inside ${symbol}`,
    };
  }

  const fieldPattern = new RegExp(`(?:^|[\\s,{])${escapeRegExp(field)}\\s*:\\s*(\\d+)`, "g");
  const matches: Array<{ value: number; absoluteIndex: number }> = [];
  for (const open of literalOpens) {
    const close = matchBrace(body, open);
    if (close === undefined) {
      return {
        ok: false,
        reason: `${compositeLiteralType} composite literal braces are unbalanced`,
      };
    }
    const literal = body.slice(open, close + 1);
    for (const m of literal.matchAll(fieldPattern)) {
      const digitsOffset = m.index! + m[0].indexOf(m[1]!);
      matches.push({
        value: Number.parseInt(m[1]!, 10),
        absoluteIndex: bodyOpen + open + digitsOffset,
      });
    }
  }

  if (matches.length === 0) {
    return {
      ok: false,
      reason: `no numeric ${field} field in ${compositeLiteralType} literal inside ${symbol}`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `ambiguous ${field}: found ${matches.length} numeric ${field} fields inside ${symbol}`,
    };
  }

  const only = matches[0]!;
  return {
    ok: true,
    value: { value: only.value, line: lineOfIndex(goSource, only.absoluteIndex) },
  };
}
