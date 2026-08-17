import type { CircuitCost } from "./analyze.js";
import type { CheckResult, Status } from "./budget.js";
import type { Toolchain } from "./toolchain.js";

function pad(text: string, width: number): string {
  return text.padEnd(width);
}

function padLeft(text: string, width: number): string {
  return text.padStart(width);
}

function costLabel(relative: number): string {
  return `${relative}x`;
}

/** Human readable per circuit cost table. */
export function formatProfile(
  costs: CircuitCost[],
  toolchain: Toolchain,
  elapsedMs: number,
): string {
  const nameWidth = Math.max(7, ...costs.map((c) => c.circuit.length));
  const rowsWidth = Math.max(4, ...costs.map((c) => String(c.rows).length));
  const capWidth = Math.max(8, ...costs.map((c) => String(c.capacity).length));
  const costWidth = Math.max(4, ...costs.map((c) => costLabel(c.relativeCost).length));

  const lines: string[] = [""];
  lines.push(
    `  ${pad("circuit", nameWidth)}  ${padLeft("rows", rowsWidth)}  ${padLeft("k", 3)}  ` +
      `${padLeft("capacity", capWidth)}  ${padLeft("cost", costWidth)}`,
  );

  for (const c of costs) {
    lines.push(
      `  ${pad(c.circuit, nameWidth)}  ${padLeft(String(c.rows), rowsWidth)}  ` +
        `${padLeft(String(c.k), 3)}  ${padLeft(String(c.capacity), capWidth)}  ` +
        `${padLeft(costLabel(c.relativeCost), costWidth)}`,
    );
  }

  const plural = costs.length === 1 ? "circuit" : "circuits";
  lines.push("");
  lines.push(
    `  ${costs.length} ${plural}, toolchain ${toolchain.version}, ` +
      `${toolchain.zkirVersion}, ${(elapsedMs / 1000).toFixed(1)}s`,
  );
  lines.push("");

  return lines.join("\n");
}

const STATUS_NOTE: Record<Status, (row: { k?: number; maxK?: number }) => string> = {
  under: (r) => `under by ${(r.maxK ?? 0) - (r.k ?? 0)}`,
  at: () => "at budget",
  over: (r) => {
    const by = (r.k ?? 0) - (r.maxK ?? 0);
    return `over by ${by}, about ${2 ** by}x`;
  },
  undeclared: () => "not in budget",
  stale: () => "no longer in contract",
};

/** Human readable budget comparison. */
export function formatCheck(result: CheckResult): string {
  const nameWidth = Math.max(7, ...result.rows.map((r) => r.circuit.length));
  const lines: string[] = [""];

  for (const row of result.rows) {
    const k = row.k === undefined ? "  -" : padLeft(String(row.k), 3);
    const maxK = row.maxK === undefined ? "  -" : padLeft(String(row.maxK), 3);
    lines.push(
      `  ${pad(row.circuit, nameWidth)}  k ${k}   budget ${maxK}   ${STATUS_NOTE[row.status](row)}`,
    );
  }

  const over = result.rows.filter((r) => r.status === "over").length;
  const undeclared = result.rows.filter((r) => r.status === "undeclared").length;

  lines.push("");
  if (over > 0) {
    lines.push(`  FAIL: ${over} circuit${over === 1 ? "" : "s"} over budget`);
  } else if (result.failed) {
    lines.push(
      `  FAIL: ${undeclared} circuit${undeclared === 1 ? "" : "s"} not declared in the budget (--strict)`,
    );
  } else {
    lines.push("  OK: every circuit within budget");
  }
  lines.push("");

  return lines.join("\n");
}

export function profileJson(
  costs: CircuitCost[],
  toolchain: Toolchain,
): string {
  return JSON.stringify(
    {
      toolchain: toolchain.version,
      zkir: toolchain.zkirVersion,
      circuits: costs,
    },
    null,
    2,
  );
}

export function checkJson(result: CheckResult): string {
  return JSON.stringify(result, null, 2);
}
