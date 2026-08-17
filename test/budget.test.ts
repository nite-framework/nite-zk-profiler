import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyze } from "../src/analyze.ts";
import { type Budget, budgetFrom, check } from "../src/budget.ts";

const costs = analyze([
  { circuit: "cheap", k: 9, rows: 305 },
  { circuit: "pricey", k: 13, rows: 4189 },
]);

const budget: Budget = {
  toolchain: "0.31.x",
  circuits: { cheap: { maxK: 9 }, pricey: { maxK: 13 } },
};

describe("budgetFrom", () => {
  it("grants each circuit exactly its current k", () => {
    assert.deepEqual(budgetFrom(costs, "0.31.x").circuits, {
      cheap: { maxK: 9 },
      pricey: { maxK: 13 },
    });
  });

  // Recorded so `check` can run with no arguments, which is what CI wants.
  it("records the contract it describes", () => {
    assert.equal(budgetFrom(costs, "0.31.x", "src/Main.compact").source, "src/Main.compact");
  });
});

describe("check", () => {
  it("passes when every circuit sits at its ceiling", () => {
    const result = check(costs, budget, false);
    assert.equal(result.failed, false);
    assert.deepEqual(
      result.rows.map((r) => r.status),
      ["at", "at"],
    );
  });

  it("passes when a circuit is under its ceiling", () => {
    const generous: Budget = {
      toolchain: "0.31.x",
      circuits: { cheap: { maxK: 10 }, pricey: { maxK: 13 } },
    };
    const result = check(costs, generous, false);
    assert.equal(result.failed, false);
    assert.equal(result.rows[0]!.status, "under");
  });

  it("fails only when a circuit exceeds its declared ceiling", () => {
    const tight: Budget = {
      toolchain: "0.31.x",
      circuits: { cheap: { maxK: 9 }, pricey: { maxK: 12 } },
    };
    const result = check(costs, tight, false);
    assert.equal(result.failed, true);
    assert.equal(result.rows.find((r) => r.circuit === "pricey")!.status, "over");
  });

  // A deliberate cost increase is not a regression. Raising the ceiling in the
  // same commit is the intended workflow, so it must pass.
  it("passes once a raised ceiling is committed", () => {
    const raised: Budget = {
      toolchain: "0.31.x",
      circuits: { cheap: { maxK: 9 }, pricey: { maxK: 14 } },
    };
    assert.equal(check(costs, raised, false).failed, false);
  });

  it("warns but passes on an undeclared circuit by default", () => {
    const partial: Budget = { toolchain: "0.31.x", circuits: { cheap: { maxK: 9 } } };
    const result = check(costs, partial, false);
    assert.equal(result.failed, false);
    assert.equal(result.rows.find((r) => r.circuit === "pricey")!.status, "undeclared");
  });

  it("fails on an undeclared circuit under --strict", () => {
    const partial: Budget = { toolchain: "0.31.x", circuits: { cheap: { maxK: 9 } } };
    assert.equal(check(costs, partial, true).failed, true);
  });

  it("reports a removed circuit as stale without failing", () => {
    const extra: Budget = {
      toolchain: "0.31.x",
      circuits: { ...budget.circuits, gone: { maxK: 9 } },
    };
    const result = check(costs, extra, true);
    assert.equal(result.failed, false);
    assert.equal(result.rows.find((r) => r.circuit === "gone")!.status, "stale");
  });
});
