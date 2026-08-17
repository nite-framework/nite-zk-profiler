import { readFileSync, writeFileSync } from "node:fs";

import { ProfilerError } from "./errors.js";
import type { CircuitCost } from "./analyze.js";

export const DEFAULT_BUDGET_PATH = "zk-budget.json";

export interface Budget {
  /** Toolchain line the ceilings were established against. */
  toolchain: string;
  circuits: Record<string, { maxK: number }>;
}

export type Status =
  | "under" // below the declared ceiling
  | "at" // exactly at the declared ceiling
  | "over" // exceeds it, this is the only failing state
  | "undeclared" // measured but absent from the budget
  | "stale"; // declared but no longer present in the contract

export interface CheckRow {
  circuit: string;
  status: Status;
  k?: number;
  maxK?: number;
}

export interface CheckResult {
  rows: CheckRow[];
  failed: boolean;
}

/** Build a budget that grants every circuit exactly what it currently costs. */
export function budgetFrom(costs: CircuitCost[], toolchainLine: string): Budget {
  const circuits: Budget["circuits"] = {};
  for (const c of [...costs].sort((a, b) => a.circuit.localeCompare(b.circuit))) {
    circuits[c.circuit] = { maxK: c.k };
  }
  return { toolchain: toolchainLine, circuits };
}

export function writeBudget(path: string, budget: Budget): void {
  writeFileSync(path, `${JSON.stringify(budget, null, 2)}\n`, "utf8");
}

export function readBudget(path: string): Budget {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new ProfilerError(
      `No budget file at ${path}`,
      "Create one from the current measurements with `nite-zk save <source>`.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ProfilerError(`Could not parse ${path}`, String(e));
  }

  const budget = parsed as Budget;
  if (!budget || typeof budget !== "object" || typeof budget.circuits !== "object") {
    throw new ProfilerError(
      `Malformed budget file: ${path}`,
      'Expected {"toolchain": "...", "circuits": {"name": {"maxK": N}}}.',
    );
  }

  for (const [name, entry] of Object.entries(budget.circuits)) {
    if (!entry || typeof entry.maxK !== "number" || !Number.isInteger(entry.maxK)) {
      throw new ProfilerError(
        `Malformed budget entry for "${name}" in ${path}`,
        'Each circuit needs an integer "maxK".',
      );
    }
  }

  return budget;
}

/**
 * Compare measurements against declared ceilings.
 *
 * The gate is a ceiling, not a diff against the last run. A circuit's `k` rising
 * is often intentional, so only exceeding a ceiling the project has committed to
 * is a failure. Raising a ceiling deliberately is a one line change a reviewer
 * sees, which is the point.
 */
export function check(
  costs: CircuitCost[],
  budget: Budget,
  strict: boolean,
): CheckResult {
  const rows: CheckRow[] = [];
  let failed = false;

  for (const cost of costs) {
    const declared = budget.circuits[cost.circuit];

    if (!declared) {
      rows.push({ circuit: cost.circuit, status: "undeclared", k: cost.k });
      if (strict) failed = true;
      continue;
    }

    let status: Status = "under";
    if (cost.k > declared.maxK) {
      status = "over";
      failed = true;
    } else if (cost.k === declared.maxK) {
      status = "at";
    }

    rows.push({ circuit: cost.circuit, status, k: cost.k, maxK: declared.maxK });
  }

  const measured = new Set(costs.map((c) => c.circuit));
  for (const name of Object.keys(budget.circuits)) {
    if (!measured.has(name)) {
      rows.push({ circuit: name, status: "stale", maxK: budget.circuits[name]!.maxK });
    }
  }

  return { rows, failed };
}
