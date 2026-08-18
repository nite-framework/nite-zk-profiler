import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyze } from "../src/analyze.ts";
import {
  type Budget,
  budgetFrom,
  budgetSources,
  check,
  mergeBudgets,
} from "../src/budget.ts";

const costs = analyze([
  { circuit: "cheap", k: 9, rows: 305 },
  { circuit: "pricey", k: 13, rows: 4189 },
]);

const measured = [{ source: "src/Main.compact", costs }];

const budget: Budget = {
  toolchain: "0.31.x",
  contracts: {
    "src/Main.compact": {
      circuits: { cheap: { maxK: 9 }, pricey: { maxK: 13 } },
    },
  },
};

const withCeilings = (cheap: number, pricey: number): Budget => ({
  toolchain: "0.31.x",
  contracts: {
    "src/Main.compact": { circuits: { cheap: { maxK: cheap }, pricey: { maxK: pricey } } },
  },
});

describe("budgetFrom", () => {
  it("grants each circuit exactly its current k", () => {
    const b = budgetFrom(measured, "0.31.x");
    assert.equal(b.contracts["src/Main.compact"]!.circuits.cheap!.maxK, 9);
    assert.equal(b.contracts["src/Main.compact"]!.circuits.pricey!.maxK, 13);
  });

  // Informational, so a reviewer can read the diff without running the tool.
  it("records rows, capacity and relative cost alongside the ceiling", () => {
    const entry = budgetFrom(measured, "0.31.x").contracts["src/Main.compact"]!.circuits.pricey!;
    assert.equal(entry.rows, 4189);
    assert.equal(entry.capacity, 8192);
    assert.equal(entry.relativeCost, 16);
  });

  it("records which tool and toolchain produced it", () => {
    const b = budgetFrom(measured, "0.31.x");
    assert.match(b.tool!, /^nite-zk-profiler /);
    assert.equal(b.toolchain, "0.31.x");
    assert.ok(b.generated);
  });

  it("keeps several contracts in one file", () => {
    const b = budgetFrom(
      [
        { source: "a/Main.compact", costs },
        { source: "b/Other.compact", costs },
      ],
      "0.31.x",
    );
    assert.deepEqual(budgetSources(b), ["a/Main.compact", "b/Other.compact"]);
  });
});

describe("check", () => {
  it("passes when every circuit sits at its ceiling", () => {
    const result = check(measured, budget, false);
    assert.equal(result.failed, false);
    assert.deepEqual(
      result.rows.map((r) => r.status),
      ["at", "at"],
    );
  });

  it("passes when a circuit is under its ceiling", () => {
    const result = check(measured, withCeilings(10, 13), false);
    assert.equal(result.failed, false);
    assert.equal(result.rows[0]!.status, "under");
  });

  it("fails only when a circuit exceeds its declared ceiling", () => {
    const result = check(measured, withCeilings(9, 12), false);
    assert.equal(result.failed, true);
    assert.equal(result.rows.find((r) => r.circuit === "pricey")!.status, "over");
  });

  // A deliberate cost increase is not a regression. Raising the ceiling in the
  // same commit is the intended workflow, so it must pass.
  it("passes once a raised ceiling is committed", () => {
    assert.equal(check(measured, withCeilings(9, 14), false).failed, false);
  });

  it("warns but passes on an undeclared circuit by default", () => {
    const partial: Budget = {
      toolchain: "0.31.x",
      contracts: { "src/Main.compact": { circuits: { cheap: { maxK: 9 } } } },
    };
    const result = check(measured, partial, false);
    assert.equal(result.failed, false);
    assert.equal(result.rows.find((r) => r.circuit === "pricey")!.status, "undeclared");
  });

  it("fails on an undeclared circuit under --strict", () => {
    const partial: Budget = {
      toolchain: "0.31.x",
      contracts: { "src/Main.compact": { circuits: { cheap: { maxK: 9 } } } },
    };
    assert.equal(check(measured, partial, true).failed, true);
  });

  it("reports a removed circuit as stale without failing", () => {
    const extra: Budget = {
      toolchain: "0.31.x",
      contracts: {
        "src/Main.compact": {
          circuits: { cheap: { maxK: 9 }, pricey: { maxK: 13 }, gone: { maxK: 9 } },
        },
      },
    };
    const result = check(measured, extra, true);
    assert.equal(result.failed, false);
    assert.equal(result.rows.find((r) => r.circuit === "gone")!.status, "stale");
  });

  it("tags each row with the contract it came from", () => {
    const result = check(measured, budget, false);
    assert.ok(result.rows.every((r) => r.contract === "src/Main.compact"));
  });
});

describe("mergeBudgets", () => {
  const a = budgetFrom([{ source: "a/A.compact", costs }], "0.31.x");
  const b = budgetFrom([{ source: "b/B.compact", costs }], "0.31.x");

  // Saving one contract must not discard the others, which is what a monorepo
  // set up a contract at a time would otherwise do.
  it("keeps contracts the new save did not mention", () => {
    const { budget, summary } = mergeBudgets(a, b);
    assert.deepEqual(budgetSources(budget).sort(), ["a/A.compact", "b/B.compact"]);
    assert.deepEqual(summary.added, ["b/B.compact"]);
    assert.deepEqual(summary.kept, ["a/A.compact"]);
  });

  it("replaces a contract that is saved again", () => {
    const raised = budgetFrom(
      [{ source: "a/A.compact", costs: analyze([{ circuit: "cheap", k: 11, rows: 305 }]) }],
      "0.31.x",
    );
    const { budget, summary } = mergeBudgets(a, raised);
    assert.deepEqual(summary.updated, ["a/A.compact"]);
    assert.equal(budget.contracts["a/A.compact"]!.circuits.cheap!.maxK, 11);
    assert.equal(budget.contracts["a/A.compact"]!.circuits.pricey, undefined);
  });
});
