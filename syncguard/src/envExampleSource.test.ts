import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseEnvExampleDefault } from "./envExampleSource.js";

const ENV_VAR = "GOTIFY_SERVER_STREAM_PINGPERIODSECONDS";

describe("parseEnvExampleDefault", () => {
  it("extracts 45 from a standard commented assignment", () => {
    const source = [
      "# Interval in seconds between WebSocket ping frames.",
      "# Type: number",
      "# GOTIFY_SERVER_STREAM_PINGPERIODSECONDS=45",
    ].join("\n");

    const result = parseEnvExampleDefault(source, ENV_VAR);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value, 45);
  });

  it("accepts harmless surrounding whitespace on the matching line", () => {
    const source = "   #   GOTIFY_SERVER_STREAM_PINGPERIODSECONDS=45   \n";
    const result = parseEnvExampleDefault(source, ENV_VAR);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value, 45);
  });

  it("returns failure when the requested variable is missing", () => {
    const source = "# GOTIFY_SERVER_PORT=80\n";
    const result = parseEnvExampleDefault(source, ENV_VAR);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /no commented integer assignment/);
  });

  it("returns failure when duplicate valid assignments exist", () => {
    const source = [
      "# GOTIFY_SERVER_STREAM_PINGPERIODSECONDS=45",
      "# GOTIFY_SERVER_STREAM_PINGPERIODSECONDS=45",
    ].join("\n");

    const result = parseEnvExampleDefault(source, ENV_VAR);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /ambiguous/);
  });

  it("returns failure for a malformed non-numeric value", () => {
    const source = "# GOTIFY_SERVER_STREAM_PINGPERIODSECONDS=abc\n";
    const result = parseEnvExampleDefault(source, ENV_VAR);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /no commented integer assignment/);
  });

  it("returns failure for an empty numeric value", () => {
    const source = "# GOTIFY_SERVER_STREAM_PINGPERIODSECONDS=\n";
    const result = parseEnvExampleDefault(source, ENV_VAR);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /no commented integer assignment/);
  });

  it("does not match a similarly named _FILE variant", () => {
    const source = "# GOTIFY_SERVER_STREAM_PINGPERIODSECONDS_FILE=45\n";
    const result = parseEnvExampleDefault(source, ENV_VAR);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /no commented integer assignment/);
  });

  it("does not match a similarly named suffixed variable", () => {
    const source = "# GOTIFY_SERVER_STREAM_PINGPERIODSECONDS_EXTRA=45\n";
    const result = parseEnvExampleDefault(source, ENV_VAR);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /no commented integer assignment/);
  });

  it("does not match an uncommented assignment", () => {
    const source = "GOTIFY_SERVER_STREAM_PINGPERIODSECONDS=45\n";
    const result = parseEnvExampleDefault(source, ENV_VAR);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /no commented integer assignment/);
  });
});
