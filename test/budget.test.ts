import { describe, expect, test } from "bun:test";

import { analyze } from "../src/analyze.js";
import { type Budget, budgetFrom, check } from "../src/budget.js";

const costs = analyze([
  { circuit: "cheap", k: 9, rows: 305 },
  { circuit: "pricey", k: 13, rows: 4189 },
]);

const budget: Budget = {
  toolchain: "0.31.x",
  circuits: { cheap: { maxK: 9 }, pricey: { maxK: 13 } },
};

describe("budgetFrom", () => {
  test("grants each circuit exactly its current k", () => {
    expect(budgetFrom(costs, "0.31.x").circuits).toEqual({
      cheap: { maxK: 9 },
      pricey: { maxK: 13 },
    });
  });
});

describe("check", () => {
  test("passes when every circuit sits at its ceiling", () => {
    const result = check(costs, budget, false);
    expect(result.failed).toBe(false);
    expect(result.rows.map((r) => r.status)).toEqual(["at", "at"]);
  });

  test("passes when a circuit is under its ceiling", () => {
    const generous: Budget = {
      toolchain: "0.31.x",
      circuits: { cheap: { maxK: 10 }, pricey: { maxK: 13 } },
    };
    const result = check(costs, generous, false);
    expect(result.failed).toBe(false);
    expect(result.rows[0]!.status).toBe("under");
  });

  test("fails only when a circuit exceeds its declared ceiling", () => {
    const tight: Budget = {
      toolchain: "0.31.x",
      circuits: { cheap: { maxK: 9 }, pricey: { maxK: 12 } },
    };
    const result = check(costs, tight, false);
    expect(result.failed).toBe(true);
    expect(result.rows.find((r) => r.circuit === "pricey")!.status).toBe("over");
  });

  // A deliberate cost increase is not a regression. Raising the ceiling in the
  // same commit is the intended workflow, so it must pass.
  test("passes once a raised ceiling is committed", () => {
    const raised: Budget = {
      toolchain: "0.31.x",
      circuits: { cheap: { maxK: 9 }, pricey: { maxK: 14 } },
    };
    expect(check(costs, raised, false).failed).toBe(false);
  });

  test("warns but passes on an undeclared circuit by default", () => {
    const partial: Budget = { toolchain: "0.31.x", circuits: { cheap: { maxK: 9 } } };
    const result = check(costs, partial, false);
    expect(result.failed).toBe(false);
    expect(result.rows.find((r) => r.circuit === "pricey")!.status).toBe("undeclared");
  });

  test("fails on an undeclared circuit under --strict", () => {
    const partial: Budget = { toolchain: "0.31.x", circuits: { cheap: { maxK: 9 } } };
    expect(check(costs, partial, true).failed).toBe(true);
  });

  test("reports a removed circuit as stale without failing", () => {
    const extra: Budget = {
      toolchain: "0.31.x",
      circuits: { ...budget.circuits, gone: { maxK: 9 } },
    };
    const result = check(costs, extra, true);
    expect(result.failed).toBe(false);
    expect(result.rows.find((r) => r.circuit === "gone")!.status).toBe("stale");
  });
});
