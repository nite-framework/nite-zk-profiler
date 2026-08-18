import type { CircuitCost } from "./analyze.ts";
import type { CheckResult, ContractCosts, Status } from "./budget.ts";
import { bold, costColor, dim, gray, green, red, visibleLength, yellow } from "./colors.ts";
import { type DeepMeasurement, formatBytes, formatMs } from "./deep.ts";
import type { DiffResult } from "./diff.ts";
import { type Calibration, estimateProvingMs, formatDuration } from "./estimate.ts";
import type { Toolchain } from "./toolchain.ts";

/** Pad accounting for ANSI escapes, which do not occupy screen columns. */
function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}

function padLeft(text: string, width: number): string {
  return " ".repeat(Math.max(0, width - visibleLength(text))) + text;
}

export type DeepByCircuit = Map<string, DeepMeasurement>;

export interface ProfileOptions {
  toolchain: Toolchain;
  elapsedMs: number;
  deep?: DeepByCircuit;
  cached?: boolean;
  calibration?: Calibration;
  showEstimate?: boolean;
}

function table(costs: CircuitCost[], opts: ProfileOptions, indent: string): string[] {
  const { deep, calibration, showEstimate } = opts;

  const cells = costs.map((c) => {
    const paint = costColor(c.relativeCost);
    const d = deep?.get(c.circuit);
    return {
      circuit: c.circuit,
      rows: String(c.rows),
      k: paint(String(c.k)),
      capacity: String(c.capacity),
      cost: paint(`${c.relativeCost}x`),
      prove: showEstimate ? `~${formatDuration(estimateProvingMs(c.k, calibration).ms)}` : "",
      setup: d ? formatMs(d.setupMs) : "",
      key: d ? formatBytes(d.proverKeyBytes) : "",
    };
  });

  const width = (header: string, get: (c: (typeof cells)[number]) => string) =>
    Math.max(header.length, ...cells.map((c) => visibleLength(get(c))));

  const w = {
    name: width("circuit", (c) => c.circuit),
    rows: width("rows", (c) => c.rows),
    k: width("k", (c) => c.k),
    cap: width("capacity", (c) => c.capacity),
    cost: width("cost", (c) => c.cost),
    prove: showEstimate ? width("est. prove", (c) => c.prove) : 0,
    setup: deep ? width("setup", (c) => c.setup) : 0,
    key: deep ? width("prover key", (c) => c.key) : 0,
  };

  const head = (): string => {
    let h =
      `${indent}${pad("circuit", w.name)}  ${padLeft("rows", w.rows)}  ${padLeft("k", w.k)}  ` +
      `${padLeft("capacity", w.cap)}  ${padLeft("cost", w.cost)}`;
    if (showEstimate) h += `  ${padLeft("est. prove", w.prove)}`;
    if (deep) h += `  ${padLeft("setup", w.setup)}  ${padLeft("prover key", w.key)}`;
    return dim(h);
  };

  const lines = [head()];
  for (const c of cells) {
    let line =
      `${indent}${pad(c.circuit, w.name)}  ${padLeft(c.rows, w.rows)}  ${padLeft(c.k, w.k)}  ` +
      `${padLeft(c.capacity, w.cap)}  ${padLeft(c.cost, w.cost)}`;
    if (showEstimate) line += `  ${padLeft(c.prove, w.prove)}`;
    if (deep) line += `  ${padLeft(c.setup, w.setup)}  ${padLeft(c.key, w.key)}`;
    lines.push(line);
  }
  return lines;
}

/** Per circuit cost table, one block per contract. */
export function formatProfile(contracts: ContractCosts[], opts: ProfileOptions): string {
  const lines: string[] = [""];
  const many = contracts.length > 1;

  for (const { source, costs } of contracts) {
    if (many) {
      lines.push(bold(`  ${source}`));
      lines.push(...table(costs, opts, "    "));
      lines.push("");
    } else {
      lines.push(...table(costs, opts, "  "));
      lines.push("");
    }
  }

  const all = contracts.flatMap((c) => c.costs);
  const circuits = all.length;
  const suffix = opts.cached ? " (cached)" : "";
  const contractNote = many ? `${contracts.length} contracts, ` : "";

  lines.push(
    gray(
      `  ${contractNote}${circuits} circuit${circuits === 1 ? "" : "s"}, ` +
        `toolchain ${opts.toolchain.version}, ${opts.toolchain.zkirVersion}, ` +
        `${(opts.elapsedMs / 1000).toFixed(1)}s${suffix}`,
    ),
  );

  if (all.length > 0) {
    const worst = all.reduce((a, b) => (b.k > a.k ? b : a), all[0]!);
    const cheapest = Math.min(...all.map((c) => c.k));
    if (worst.k > cheapest) {
      lines.push(
        gray(
          `  ${bold(worst.circuit)} dominates at k=${worst.k}, ` +
            `${2 ** (worst.k - cheapest)}x the cheapest circuit here.`,
        ),
      );
    }
  }

  if (opts.showEstimate) {
    lines.push(
      gray(
        opts.calibration
          ? `  est. prove is modelled as 2^k, calibrated from an observed ${formatDuration(opts.calibration.observedMs)} proof at k=${opts.calibration.observedK}.`
          : "  est. prove is modelled as 2^k on an uncalibrated default. Run `nite-zk calibrate` to anchor it.",
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

/** Budget comparison, grouped by contract when there is more than one. */
export function formatCheck(result: CheckResult): string {
  const contracts = [...new Set(result.rows.map((r) => r.contract))];
  const many = contracts.length > 1;
  const lines: string[] = [""];

  for (const contract of contracts) {
    const rows = result.rows.filter((r) => r.contract === contract);
    const indent = many ? "    " : "  ";
    if (many) lines.push(bold(`  ${contract}`));

    const wName = Math.max(7, ...rows.map((r) => r.circuit.length));
    for (const row of rows) {
      const k = row.k === undefined ? "  -" : padLeft(String(row.k), 3);
      const maxK = row.maxK === undefined ? "  -" : padLeft(String(row.maxK), 3);
      const paint = row.status === "over" ? red : (t: string) => t;
      lines.push(
        `${indent}${pad(paint(row.circuit), wName)}  k ${k}   ${dim("budget")} ${maxK}   ` +
          STATUS_NOTE[row.status](row),
      );
    }
    if (many) lines.push("");
  }

  const over = result.rows.filter((r) => r.status === "over").length;
  const undeclared = result.rows.filter((r) => r.status === "undeclared").length;

  if (!many) lines.push("");
  if (over > 0) {
    lines.push(red(bold(`  FAIL: ${over} circuit${over === 1 ? "" : "s"} over budget`)));
  } else if (result.failed) {
    lines.push(
      red(bold(`  FAIL: ${undeclared} circuit${undeclared === 1 ? "" : "s"} not declared (--strict)`)),
    );
  } else {
    lines.push(green(bold("  OK: every circuit within budget")));
  }
  lines.push("");

  return lines.join("\n");
}

/** Comparison against a git ref. */
export function formatDiff(result: DiffResult): string {
  const lines: string[] = [""];
  const wName = Math.max(7, ...result.rows.map((r) => r.circuit.length));

  for (const row of result.rows) {
    const before = row.before === undefined ? dim("  -") : padLeft(String(row.before), 3);
    const after = row.after === undefined ? dim("  -") : padLeft(String(row.after), 3);

    let note: string;
    if (row.before === undefined) note = yellow("new circuit");
    else if (row.after === undefined) note = dim("removed");
    else if (row.after > row.before)
      note = red(`+${row.after - row.before}, about ${2 ** (row.after - row.before)}x more expensive`);
    else if (row.after < row.before)
      note = green(`${row.after - row.before}, about ${2 ** (row.before - row.after)}x cheaper`);
    else note = dim("unchanged");

    lines.push(`  ${pad(row.circuit, wName)}  k ${before} ${dim("->")} ${after}   ${note}`);
  }

  const worse = result.rows.filter(
    (r) => r.before !== undefined && r.after !== undefined && r.after > r.before,
  ).length;

  lines.push("");
  lines.push(
    worse > 0
      ? red(bold(`  ${worse} circuit${worse === 1 ? "" : "s"} more expensive than ${result.ref}`))
      : green(bold(`  nothing more expensive than ${result.ref}`)),
  );
  lines.push("");

  return lines.join("\n");
}

export function profileJson(contracts: ContractCosts[], opts: ProfileOptions): string {
  return JSON.stringify(
    {
      toolchain: opts.toolchain.version,
      zkir: opts.toolchain.zkirVersion,
      contracts: contracts.map(({ source, costs }) => ({
        source,
        circuits: costs.map((c) => {
          const d = opts.deep?.get(c.circuit);
          const est = opts.showEstimate
            ? {
                estimatedProvingMs: Math.round(estimateProvingMs(c.k, opts.calibration).ms),
                estimateCalibrated: opts.calibration !== undefined,
              }
            : {};
          return d
            ? { ...c, ...est, setupMs: Math.round(d.setupMs), proverKeyBytes: d.proverKeyBytes }
            : { ...c, ...est };
        }),
      })),
    },
    null,
    2,
  );
}

export function checkJson(result: CheckResult): string {
  return JSON.stringify(result, null, 2);
}

export function diffJson(result: DiffResult): string {
  return JSON.stringify(result, null, 2);
}
