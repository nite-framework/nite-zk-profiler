import { describe, expect, test } from "bun:test";

import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  test("reads a command and source", () => {
    const opts = parseArgs(["profile", "Sample.compact"]);
    expect(opts.command).toBe("profile");
    expect(opts.source).toBe("Sample.compact");
  });

  test("defaults the budget path", () => {
    expect(parseArgs(["check", "S.compact"]).budget).toBe("zk-budget.json");
  });

  test("takes flags in any position", () => {
    const opts = parseArgs(["--json", "profile", "--strict", "S.compact"]);
    expect(opts.command).toBe("profile");
    expect(opts.source).toBe("S.compact");
    expect(opts.json).toBe(true);
    expect(opts.strict).toBe(true);
  });

  test("captures a +VERSION pin without treating it as the command", () => {
    const opts = parseArgs(["profile", "+0.31.1", "S.compact"]);
    expect(opts.versionArg).toBe("+0.31.1");
    expect(opts.command).toBe("profile");
    expect(opts.source).toBe("S.compact");
  });

  test("reads --out and --budget values", () => {
    const opts = parseArgs(["check", "S.compact", "--out", "build", "--budget", "b.json"]);
    expect(opts.out).toBe("build");
    expect(opts.budget).toBe("b.json");
  });
});
