import { readFileSync, writeFileSync } from "node:fs";

import type { CircuitCost } from "./analyze.ts";
import { ProfilerError } from "./errors.ts";
import { toolVersion } from "./version.ts";

export const DEFAULT_BUDGET_PATH = "zk-budget.json";

/**
 * Per circuit entry.
 *
 * `maxK` is the only enforced field. The rest is a snapshot recorded at save
 * time so a reviewer reading the diff can see what changed and by how much,
 * without running the tool. Snapshot drift never fails a check.
 */
export interface CircuitBudget {
  maxK: number;
  rows?: number;
  capacity?: number;
  relativeCost?: number;
}

export interface ContractBudget {
  circuits: Record<string, CircuitBudget>;
}

export interface Budget {
  /** Which release wrote this, so an old file can be recognised. */
  tool?: string;
  /** Toolchain line the ceilings were established against. */
  toolchain: string;
  generated?: string;
  /** Keyed by source path, relative to the budget file. */
  contracts: Record<string, ContractBudget>;
}

/** Shape written before multi contract support. Still read, never written. */
interface LegacyBudget {
  toolchain: string;
  source?: string;
  circuits: Record<string, { maxK: number }>;
}

export type Status =
  | "under" // below the declared ceiling
  | "at" // exactly at the declared ceiling
  | "over" // exceeds it, the only failing state
  | "undeclared" // measured but absent from the budget
  | "stale"; // declared but no longer present in the contract

export interface CheckRow {
  contract: string;
  circuit: string;
  status: Status;
  k?: number;
  maxK?: number;
}

export interface CheckResult {
  rows: CheckRow[];
  failed: boolean;
}

/** Measurements for one contract, as the CLI collects them. */
export interface ContractCosts {
  source: string;
  costs: CircuitCost[];
}

/** Build a budget granting every circuit exactly what it currently costs. */
export function budgetFrom(contracts: ContractCosts[], toolchainLine: string): Budget {
  const out: Budget["contracts"] = {};

  for (const { source, costs } of [...contracts].sort((a, b) =>
    a.source.localeCompare(b.source),
  )) {
    const circuits: Record<string, CircuitBudget> = {};
    for (const c of [...costs].sort((a, b) => a.circuit.localeCompare(b.circuit))) {
      circuits[c.circuit] = {
        maxK: c.k,
        rows: c.rows,
        capacity: c.capacity,
        relativeCost: c.relativeCost,
      };
    }
    out[source] = { circuits };
  }

  return {
    tool: `nite-zk-profiler ${toolVersion()}`,
    toolchain: toolchainLine,
    generated: new Date().toISOString(),
    contracts: out,
  };
}

export function writeBudget(path: string, budget: Budget): void {
  writeFileSync(path, `${JSON.stringify(budget, null, 2)}\n`, "utf8");
}

/** Bring the pre multi contract shape forward, so old files keep working. */
function normalise(parsed: Budget | LegacyBudget, path: string): Budget {
  if ("contracts" in parsed && parsed.contracts) return parsed;

  const legacy = parsed as LegacyBudget;
  if (!legacy.circuits) {
    throw new ProfilerError(
      `Malformed budget file: ${path}`,
      'Expected a "contracts" map. Rewrite it with `nite-zk save <source>`.',
    );
  }

  return {
    toolchain: legacy.toolchain,
    contracts: {
      [legacy.source ?? ""]: {
        circuits: Object.fromEntries(
          Object.entries(legacy.circuits).map(([n, e]) => [n, { maxK: e.maxK }]),
        ),
      },
    },
  };
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

  if (!parsed || typeof parsed !== "object") {
    throw new ProfilerError(`Malformed budget file: ${path}`, "Expected a JSON object.");
  }

  const budget = normalise(parsed as Budget | LegacyBudget, path);

  for (const [source, contract] of Object.entries(budget.contracts)) {
    for (const [name, entry] of Object.entries(contract.circuits ?? {})) {
      if (!entry || typeof entry.maxK !== "number" || !Number.isInteger(entry.maxK)) {
        throw new ProfilerError(
          `Malformed budget entry for "${name}" in ${source || path}`,
          'Each circuit needs an integer "maxK".',
        );
      }
    }
  }

  return budget;
}

/** Every contract the budget describes. */
export function budgetSources(budget: Budget): string[] {
  return Object.keys(budget.contracts).filter((s) => s.length > 0);
}

/**
 * Compare measurements against declared ceilings.
 *
 * The gate is a ceiling, not a diff against the last run. A circuit's `k`
 * rising is often intentional, so only exceeding a ceiling the project has
 * committed to is a failure. Raising a ceiling deliberately is a one line
 * change a reviewer sees, which is the point.
 */
export function check(
  measured: ContractCosts[],
  budget: Budget,
  strict: boolean,
): CheckResult {
  const rows: CheckRow[] = [];
  let failed = false;

  for (const { source, costs } of measured) {
    const declared =
      budget.contracts[source]?.circuits ??
      // A legacy budget stores its single contract under "", so fall back to it
      // when only one contract is declared and the path does not match.
      (Object.keys(budget.contracts).length === 1
        ? Object.values(budget.contracts)[0]!.circuits
        : {});

    for (const cost of costs) {
      const entry = declared[cost.circuit];

      if (!entry) {
        rows.push({
          contract: source,
          circuit: cost.circuit,
          status: "undeclared",
          k: cost.k,
        });
        if (strict) failed = true;
        continue;
      }

      let status: Status = "under";
      if (cost.k > entry.maxK) {
        status = "over";
        failed = true;
      } else if (cost.k === entry.maxK) {
        status = "at";
      }

      rows.push({
        contract: source,
        circuit: cost.circuit,
        status,
        k: cost.k,
        maxK: entry.maxK,
      });
    }

    const seen = new Set(costs.map((c) => c.circuit));
    for (const [name, entry] of Object.entries(declared)) {
      if (!seen.has(name)) {
        rows.push({ contract: source, circuit: name, status: "stale", maxK: entry.maxK });
      }
    }
  }

  return { rows, failed };
}
