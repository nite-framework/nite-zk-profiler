import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseReport } from "../src/measure.ts";

describe("parseReport", () => {
  it("reads circuit name, k and rows", () => {
    const report = [
      "Mock compiling 2 circuits:",
      '  circuit "balanceOf" (k=9, rows=305)',
      '  circuit "register" (k=9, rows=368)',
      "",
    ].join("\n");

    assert.deepEqual(parseReport(report), [
      { circuit: "balanceOf", k: 9, rows: 305 },
      { circuit: "register", k: 9, rows: 368 },
    ]);
  });

  it("handles a single circuit, where zkir still says 'circuits'", () => {
    const report = 'Mock compiling 1 circuits:\n  circuit "bump" (k=5, rows=24)\n';
    assert.deepEqual(parseReport(report), [{ circuit: "bump", k: 5, rows: 24 }]);
  });

  it("keeps circuit names containing underscores", () => {
    const report =
      'Mock compiling 1 circuits:\n  circuit "Governance_applyConfig" (k=9, rows=171)\n';
    assert.equal(parseReport(report)[0]!.circuit, "Governance_applyConfig");
  });

  // The v3 binary against v2 IR prints a normal looking header and part of the
  // first circuit before dying. Reading line by line would report that as a
  // complete, successful run.
  it("rejects a truncated report rather than reporting partial results", () => {
    const truncated =
      'Mock compiling 2 circuits:\n  circuit "balanceOf" (k=9, rows=305)\n';
    assert.throws(() => parseReport(truncated), /Truncated/);
  });

  it("rejects output with no header", () => {
    assert.throws(() => parseReport("Error: Unhandled version: 2.0"), /parse/);
  });

  it("rejects empty output, which is what reading stdout instead of stderr gives", () => {
    assert.throws(() => parseReport(""), /parse/);
  });
});
