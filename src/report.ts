import type { CircuitCost } from "./analyze.ts";
import type { CheckResult, Status } from "./budget.ts";
import {
  bold,
  costColor,
  dim,
  gray,
  green,
  red,
  visibleLength,
  yellow,
} from "./colors.ts";
import { type DeepMeasurement, formatBytes, formatMs } from "./deep.ts";
import type { Toolchain } from "./toolchain.ts";

/** Pad accounting for ANSI escapes, which do not occupy screen columns. */
function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}

function padLeft(text: string, width: number): string {
  return " ".repeat(Math.max(0, width - visibleLength(text))) + text;
}

function costLabel(relative: number): string {
  return `${relative}x`;
}

export type DeepByCircuit = Map<string, DeepMeasurement>;

/** Human readable per circuit cost table. */
export function formatProfile(
  costs: CircuitCost[],
  toolchain: Toolchain,
  elapsedMs: number,
  deep?: DeepByCircuit,
  cached = false,
): string {
  const cells = costs.map((c) => {
    const paint = costColor(c.relativeCost);
    const d = deep?.get(c.circuit);
    return {
      circuit: c.circuit,
      rows: String(c.rows),
      k: paint(String(c.k)),
      capacity: String(c.capacity),
      cost: paint(costLabel(c.relativeCost)),
      setup: d ? formatMs(d.setupMs) : "",
      key: d ? formatBytes(d.proverKeyBytes) : "",
    };
  });

  const width = (header: string, get: (c: (typeof cells)[number]) => string) =>
    Math.max(header.length, ...cells.map((c) => visibleLength(get(c))));

  const wName = width("circuit", (c) => c.circuit);
  const wRows = width("rows", (c) => c.rows);
  const wK = width("k", (c) => c.k);
  const wCap = width("capacity", (c) => c.capacity);
  const wCost = width("cost", (c) => c.cost);
  const wSetup = deep ? width("setup", (c) => c.setup) : 0;
  const wKey = deep ? width("prover key", (c) => c.key) : 0;

  const lines: string[] = [""];

  let header =
    `  ${pad("circuit", wName)}  ${padLeft("rows", wRows)}  ${padLeft("k", wK)}  ` +
    `${padLeft("capacity", wCap)}  ${padLeft("cost", wCost)}`;
  if (deep) header += `  ${padLeft("setup", wSetup)}  ${padLeft("prover key", wKey)}`;
  lines.push(dim(header));

  for (const c of cells) {
    let line =
      `  ${pad(c.circuit, wName)}  ${padLeft(c.rows, wRows)}  ${padLeft(c.k, wK)}  ` +
      `${padLeft(c.capacity, wCap)}  ${padLeft(c.cost, wCost)}`;
    if (deep) line += `  ${padLeft(c.setup, wSetup)}  ${padLeft(c.key, wKey)}`;
    lines.push(line);
  }

  const plural = costs.length === 1 ? "circuit" : "circuits";
  lines.push("");
  lines.push(
    gray(
      `  ${costs.length} ${plural}, toolchain ${toolchain.version}, ` +
        `${toolchain.zkirVersion}, ${(elapsedMs / 1000).toFixed(1)}s${cached ? " (cached)" : ""}`,
    ),
  );

  const worst = costs.reduce((a, b) => (b.k > a.k ? b : a), costs[0]!);
  const cheapest = Math.min(...costs.map((c) => c.k));
  if (worst.k > cheapest) {
    lines.push(
      gray(
        `  ${bold(worst.circuit)} dominates at k=${worst.k}, ` +
          `${worst.relativeCost}x the cheapest circuit here.`,
      ),
    );
  }
  lines.push("");

  return lines.join("\n");
}

const STATUS_NOTE: Record<Status, (row: { k?: number; maxK?: number }) => string> = {
  under: (r) => green(`under by ${(r.maxK ?? 0) - (r.k ?? 0)}`),
  at: () => green("at budget"),
  over: (r) => {
    const by = (r.k ?? 0) - (r.maxK ?? 0);
    return red(`over by ${by}, about ${2 ** by}x`);
  },
  undeclared: () => yellow("not in budget"),
  stale: () => dim("no longer in contract"),
};

/** Human readable budget comparison. */
export function formatCheck(result: CheckResult): string {
  const wName = Math.max(7, ...result.rows.map((r) => r.circuit.length));
  const lines: string[] = [""];

  for (const row of result.rows) {
    const k = row.k === undefined ? "  -" : padLeft(String(row.k), 3);
    const maxK = row.maxK === undefined ? "  -" : padLeft(String(row.maxK), 3);
    const paint = row.status === "over" ? red : (t: string) => t;
    lines.push(
      `  ${pad(paint(row.circuit), wName)}  k ${k}   ${dim("budget")} ${maxK}   ` +
        STATUS_NOTE[row.status](row),
    );
  }

  const over = result.rows.filter((r) => r.status === "over").length;
  const undeclared = result.rows.filter((r) => r.status === "undeclared").length;

  lines.push("");
  if (over > 0) {
    lines.push(red(bold(`  FAIL: ${over} circuit${over === 1 ? "" : "s"} over budget`)));
  } else if (result.failed) {
    lines.push(
      red(
        bold(
          `  FAIL: ${undeclared} circuit${undeclared === 1 ? "" : "s"} not declared in the budget (--strict)`,
        ),
      ),
    );
  } else {
    lines.push(green(bold("  OK: every circuit within budget")));
  }
  lines.push("");

  return lines.join("\n");
}

export function profileJson(
  costs: CircuitCost[],
  toolchain: Toolchain,
  deep?: DeepByCircuit,
): string {
  return JSON.stringify(
    {
      toolchain: toolchain.version,
      zkir: toolchain.zkirVersion,
      circuits: costs.map((c) => {
        const d = deep?.get(c.circuit);
        return d
          ? { ...c, setupMs: Math.round(d.setupMs), proverKeyBytes: d.proverKeyBytes }
          : c;
      }),
    },
    null,
    2,
  );
}

export function checkJson(result: CheckResult): string {
  return JSON.stringify(result, null, 2);
}
