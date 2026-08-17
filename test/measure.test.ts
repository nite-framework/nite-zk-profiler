import { describe, expect, test } from "bun:test";

import { parseReport } from "../src/measure.js";

describe("parseReport", () => {
  test("reads circuit name, k and rows", () => {
    const report = [
      "Mock compiling 2 circuits:",
      '  circuit "balanceOf" (k=9, rows=305)',
      '  circuit "register" (k=9, rows=368)',
      "",
    ].join("\n");

    expect(parseReport(report)).toEqual([
      { circuit: "balanceOf", k: 9, rows: 305 },
      { circuit: "register", k: 9, rows: 368 },
    ]);
  });

  test("handles a single circuit, where zkir still says 'circuits'", () => {
    const report = 'Mock compiling 1 circuits:\n  circuit "bump" (k=5, rows=24)\n';
    expect(parseReport(report)).toEqual([{ circuit: "bump", k: 5, rows: 24 }]);
  });

  test("keeps circuit names containing underscores", () => {
    const report =
      'Mock compiling 1 circuits:\n  circuit "Governance_applyConfig" (k=9, rows=171)\n';
    expect(parseReport(report)[0]!.circuit).toBe("Governance_applyConfig");
  });

  // The v3 binary against v2 IR prints a normal looking header and part of the
  // first circuit before dying. Reading line by line would report that as a
  // complete, successful run.
  test("rejects a truncated report rather than reporting partial results", () => {
    const truncated =
      'Mock compiling 2 circuits:\n  circuit "balanceOf" (k=9, rows=305)\n';
    expect(() => parseReport(truncated)).toThrow(/Truncated/);
  });

  test("rejects output with no header", () => {
    expect(() => parseReport("Error: Unhandled version: 2.0")).toThrow(/parse/);
  });

  test("rejects empty output, which is what reading stdout instead of stderr gives", () => {
    expect(() => parseReport("")).toThrow(/parse/);
  });
});
