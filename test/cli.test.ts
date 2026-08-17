import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseArgs } from "../src/cli.ts";

describe("parseArgs", () => {
  it("reads a command and source", () => {
    const opts = parseArgs(["profile", "Sample.compact"]);
    assert.equal(opts.command, "profile");
    assert.equal(opts.source, "Sample.compact");
  });

  it("defaults the budget path", () => {
    assert.equal(parseArgs(["check", "S.compact"]).budget, "zk-budget.json");
  });

  it("takes flags in any position", () => {
    const opts = parseArgs(["--json", "profile", "--strict", "S.compact"]);
    assert.equal(opts.command, "profile");
    assert.equal(opts.source, "S.compact");
    assert.equal(opts.json, true);
    assert.equal(opts.strict, true);
  });

  it("captures a +VERSION pin without treating it as the command", () => {
    const opts = parseArgs(["profile", "+0.31.1", "S.compact"]);
    assert.equal(opts.versionArg, "+0.31.1");
    assert.equal(opts.command, "profile");
    assert.equal(opts.source, "S.compact");
  });

  it("parses --deep and --no-color", () => {
    const opts = parseArgs(["profile", "S.compact", "--deep", "--no-color"]);
    assert.equal(opts.deep, true);
    assert.equal(opts.noColor, true);
  });

  it("allows check with no source, which the budget can supply", () => {
    const opts = parseArgs(["check"]);
    assert.equal(opts.command, "check");
    assert.equal(opts.source, undefined);
  });

  it("reads --out and --budget values", () => {
    const opts = parseArgs(["check", "S.compact", "--out", "build", "--budget", "b.json"]);
    assert.equal(opts.out, "build");
    assert.equal(opts.budget, "b.json");
  });
});
