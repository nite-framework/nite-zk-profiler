import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parseArgs } from "../src/cli.ts";
import { toolVersion } from "../src/version.ts";

describe("parseArgs", () => {
  it("reads a command and source", () => {
    const opts = parseArgs(["profile", "Sample.compact"]);
    assert.equal(opts.command, "profile");
    assert.deepEqual(opts.sources, ["Sample.compact"]);
  });

  it("defaults the budget path", () => {
    assert.equal(parseArgs(["check", "S.compact"]).budget, "zk-budget.json");
  });

  it("takes flags in any position", () => {
    const opts = parseArgs(["--json", "profile", "--strict", "S.compact"]);
    assert.equal(opts.command, "profile");
    assert.deepEqual(opts.sources, ["S.compact"]);
    assert.equal(opts.json, true);
    assert.equal(opts.strict, true);
  });

  it("captures a +VERSION pin without treating it as the command", () => {
    const opts = parseArgs(["profile", "+0.31.1", "S.compact"]);
    assert.equal(opts.versionArg, "+0.31.1");
    assert.equal(opts.command, "profile");
    assert.deepEqual(opts.sources, ["S.compact"]);
  });

  it("parses --deep and --no-color", () => {
    const opts = parseArgs(["profile", "S.compact", "--deep", "--no-color"]);
    assert.equal(opts.deep, true);
    assert.equal(opts.noColor, true);
  });

  it("allows check with no source, which the budget can supply", () => {
    const opts = parseArgs(["check"]);
    assert.equal(opts.command, "check");
    assert.deepEqual(opts.sources, []);
  });

  it("collects several sources for a monorepo", () => {
    const opts = parseArgs(["profile", "a/A.compact", "b/B.compact", "c/C.compact"]);
    assert.deepEqual(opts.sources, ["a/A.compact", "b/B.compact", "c/C.compact"]);
  });

  it("takes the ref first for diff, then the source", () => {
    const opts = parseArgs(["diff", "main", "src/Main.compact"]);
    assert.equal(opts.command, "diff");
    assert.equal(opts.ref, "main");
    assert.deepEqual(opts.sources, ["src/Main.compact"]);
  });

  it("parses calibration arguments", () => {
    const opts = parseArgs(["calibrate", "--observed", "9000", "--at-k", "16"]);
    assert.equal(opts.observedMs, 9000);
    assert.equal(opts.atK, 16);
  });

  it("parses --estimate", () => {
    assert.equal(parseArgs(["profile", "S.compact", "--estimate"]).estimate, true);
  });

  it("reads --out and --budget values", () => {
    const opts = parseArgs(["check", "S.compact", "--out", "build", "--budget", "b.json"]);
    assert.equal(opts.out, "build");
    assert.equal(opts.budget, "b.json");
  });
});

describe("version reporting", () => {
  // `npm version` edits package.json only, so a hardcoded literal here would
  // silently report the wrong release after every bump.
  it("matches package.json", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
    );
    assert.equal(toolVersion(), manifest.version);
  });
});
