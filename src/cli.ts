#!/usr/bin/env node
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { analyze } from "./analyze.ts";
import {
  type ContractCosts,
  DEFAULT_BUDGET_PATH,
  budgetFrom,
  budgetSources,
  check,
  readBudget,
  writeBudget,
} from "./budget.ts";
import { cacheKey, readCache, writeCache } from "./cache.ts";
import { setColorEnabled } from "./colors.ts";
import { compileSkipZk } from "./compile.ts";
import { measureDeep } from "./deep.ts";
import { diffCosts, materialise, pathWithinRef, repoRoot } from "./diff.ts";
import { ProfilerError } from "./errors.ts";
import { calibrationFrom, readCalibration, writeCalibration } from "./estimate.ts";
import { measureParallel } from "./measure.ts";
import { Progress } from "./progress.ts";
import {
  type DeepByCircuit,
  type ProfileOptions,
  checkJson,
  diffJson,
  formatCheck,
  formatDiff,
  formatProfile,
  profileJson,
} from "./report.ts";
import { SUPPORTED_RANGES, resolveToolchain } from "./toolchain.ts";
import { toolVersion } from "./version.ts";

const USAGE = `nite-zk - see what a Compact circuit costs to prove

Usage:
  nite-zk profile <source...>   Report rows, k and relative cost per circuit
  nite-zk save <source...>      Write zk-budget.json from current measurements
  nite-zk check [<source...>]   Compare against zk-budget.json
                                Sources are optional once saved, since the
                                budget records which contracts it describes.
  nite-zk diff <ref> [<source>] Compare a contract against a git ref
  nite-zk calibrate --observed <ms> --at-k <k>
                                Anchor proving estimates to a real proof

Options:
  --estimate                    Show modelled proving time per circuit
  --deep                        Also generate real proving keys and report
                                measured setup time and prover key size
  --json                        Machine readable output
  --out <dir>                   Compile into a specific directory (kept)
  --budget <file>               Budget path (default: ${DEFAULT_BUDGET_PATH})
  --strict                      check: fail on circuits missing from the budget
  --no-color                    Plain output (also honours NO_COLOR)
  --no-cache                    Ignore cached measurements for this run
  +VERSION                      Pin the Compact toolchain, e.g. +0.31.1
  -h, --help                    Show this message
  -v, --version                 Show the tool version

Supported Compact toolchains: ${SUPPORTED_RANGES.join(", ")}
`;

interface Options {
  command?: string;
  sources: string[];
  ref?: string;
  json: boolean;
  strict: boolean;
  deep: boolean;
  estimate: boolean;
  noColor: boolean;
  noCache: boolean;
  out?: string;
  budget: string;
  versionArg?: string;
  observedMs?: number;
  atK?: number;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    sources: [],
    json: false,
    strict: false,
    deep: false,
    estimate: false,
    noColor: false,
    noCache: false,
    budget: DEFAULT_BUDGET_PATH,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--json") opts.json = true;
    else if (arg === "--strict") opts.strict = true;
    else if (arg === "--deep") opts.deep = true;
    else if (arg === "--estimate") opts.estimate = true;
    else if (arg === "--no-color") opts.noColor = true;
    else if (arg === "--no-cache") opts.noCache = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "-v" || arg === "--version") opts.version = true;
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--budget") opts.budget = argv[++i] ?? DEFAULT_BUDGET_PATH;
    else if (arg === "--observed") opts.observedMs = Number(argv[++i]);
    else if (arg === "--at-k") opts.atK = Number(argv[++i]);
    else if (arg.startsWith("+")) opts.versionArg = arg;
    else if (!opts.command) opts.command = arg;
    else if (opts.command === "diff" && opts.ref === undefined) opts.ref = arg;
    else opts.sources.push(arg);
  }

  return opts;
}

/** Compile and measure one contract. */
async function profileOne(
  source: string,
  opts: Options,
  progress: Progress,
  label: string,
) {
  progress.update(`${label}compiling`);
  const toolchain = resolveToolchain(opts.versionArg);
  const compiled = await compileSkipZk(source, toolchain, opts.out);

  try {
    // The compile is the cheap half, so it always runs and its output keys the
    // cache. Identical IR cannot produce different constraint counts.
    const key = opts.noCache ? undefined : cacheKey(compiled.zkirDir, toolchain);
    let measurements = key ? readCache(key) : undefined;
    const cached = measurements !== undefined;

    if (!measurements) {
      measurements = await measureParallel(compiled.zkirDir, toolchain, source, (d, t) =>
        progress.update(`${label}measuring  ${d}/${t}`),
      );
      if (key) writeCache(key, measurements);
    }

    let deep: DeepByCircuit | undefined;
    if (opts.deep) {
      const results = await measureDeep(measurements, compiled.zkirDir, toolchain, (c, i, n) =>
        progress.update(`${label}generating proving keys  ${i + 1}/${n}  ${c}`),
      );
      deep = new Map(results.map((r) => [r.circuit, r]));
    }

    return { costs: analyze(measurements), toolchain, deep, cached };
  } finally {
    compiled.cleanup();
  }
}

/** Compile and measure every requested contract. */
async function profileAll(sources: string[], opts: Options) {
  const started = performance.now();
  const progress = new Progress(!opts.json);
  progress.start("resolving toolchain");

  try {
    const contracts: ContractCosts[] = [];
    let toolchain!: Awaited<ReturnType<typeof profileOne>>["toolchain"];
    let deep: DeepByCircuit | undefined;
    let cached = true;

    for (const [i, source] of sources.entries()) {
      const label = sources.length > 1 ? `[${i + 1}/${sources.length}] ` : "";
      const r = await profileOne(source, opts, progress, label);
      contracts.push({ source, costs: r.costs });
      toolchain = r.toolchain;
      if (r.deep) deep = new Map([...(deep ?? []), ...r.deep]);
      if (!r.cached) cached = false;
    }

    progress.stop();
    return { contracts, toolchain, deep, cached, elapsedMs: performance.now() - started };
  } finally {
    progress.stop();
  }
}

/** Paths recorded in a budget are relative to the budget file. */
function sourcesFromBudget(budgetPath: string, recorded: string[]): string[] {
  const base = dirname(resolve(budgetPath));
  return recorded.map((s) => (isAbsolute(s) ? s : resolve(base, s)));
}

function profileOptions(
  opts: Options,
  run: Awaited<ReturnType<typeof profileAll>>,
): ProfileOptions {
  return {
    toolchain: run.toolchain,
    elapsedMs: run.elapsedMs,
    deep: run.deep,
    cached: run.cached,
    calibration: readCalibration(opts.budget),
    showEstimate: opts.estimate,
  };
}

async function runDiff(opts: Options): Promise<number> {
  if (!opts.ref) {
    throw new ProfilerError("diff needs a git ref", "    nite-zk diff main src/Main.compact");
  }

  const root = repoRoot();
  const sources = opts.sources.length
    ? opts.sources
    : sourcesFromBudget(opts.budget, budgetSources(readBudget(opts.budget)));

  if (sources.length !== 1) {
    throw new ProfilerError(
      "diff compares one contract at a time",
      `Got ${sources.length} contracts. Name the one to compare:\n    nite-zk diff ${opts.ref} src/Main.compact`,
    );
  }

  const source = sources[0]!;
  const after = await profileAll([source], opts);

  const exported = await materialise(opts.ref);
  try {
    const basePath = pathWithinRef(source, root, exported.dir);
    const before = await profileAll([basePath], opts);
    const result = diffCosts(opts.ref, before.contracts[0]!.costs, after.contracts[0]!.costs);
    process.stdout.write(opts.json ? `${diffJson(result)}\n` : formatDiff(result));
    return result.regressed ? 1 : 0;
  } finally {
    exported.cleanup();
  }
}

export async function run(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);

  if (opts.noColor || opts.json) setColorEnabled(false);

  // Checked before the no-command case, since `nite-zk -v` carries no command
  // and would otherwise fall through to the usage text.
  if (opts.version) {
    process.stdout.write(`nite-zk-profiler ${toolVersion()}\n`);
    return 0;
  }

  if (opts.help || !opts.command) {
    process.stdout.write(USAGE);
    return opts.command ? 0 : 1;
  }

  const known = ["profile", "save", "check", "diff", "calibrate"];
  if (!known.includes(opts.command)) {
    process.stderr.write(`Unknown command: ${opts.command}\n\n${USAGE}`);
    return 1;
  }

  if (opts.command === "calibrate") {
    if (!opts.observedMs || !opts.atK) {
      throw new ProfilerError(
        "calibrate needs an observed proof",
        "Time one real proof, then record it:\n" +
          "    nite-zk calibrate --observed 9000 --at-k 16\n" +
          "where --observed is milliseconds and --at-k is that circuit's k.",
      );
    }
    const calibration = calibrationFrom(opts.observedMs, opts.atK);
    writeCalibration(opts.budget, calibration);
    process.stdout.write(
      `Calibrated: ${calibration.msPerDomainRow.toFixed(4)} ms per domain row, ` +
        `from ${opts.observedMs}ms at k=${opts.atK}.\n` +
        "Estimates now use this machine's rate. Re-run `nite-zk calibrate` if the prover changes.\n",
    );
    return 0;
  }

  if (opts.command === "diff") return runDiff(opts);

  if (opts.command !== "check" && opts.sources.length === 0) {
    throw new ProfilerError(
      `${opts.command} needs at least one source file`,
      `    nite-zk ${opts.command} src/Main.compact`,
    );
  }

  if (opts.command === "check") {
    // Read the budget first, so a missing one is reported before spending time
    // on a compile, and so it can supply the source paths.
    const budget = readBudget(opts.budget);
    const recorded = budgetSources(budget);
    const sources = opts.sources.length
      ? opts.sources
      : sourcesFromBudget(opts.budget, recorded);

    if (sources.length === 0) {
      throw new ProfilerError(
        "check needs a source file",
        `${opts.budget} does not record which contracts it describes.\n` +
          "Either pass them:\n    nite-zk check src/Main.compact\n" +
          "or rewrite the budget so it remembers:\n    nite-zk save src/Main.compact",
      );
    }

    const run_ = await profileAll(sources, opts);
    // Compare using the paths as the budget records them.
    const base = dirname(resolve(opts.budget));
    const keyed = run_.contracts.map((c, i) => ({
      source: opts.sources.length ? relative(base, resolve(c.source)) : recorded[i] ?? c.source,
      costs: c.costs,
    }));

    const result = check(keyed, budget, opts.strict);
    process.stdout.write(opts.json ? `${checkJson(result)}\n` : formatCheck(result));
    return result.failed ? 1 : 0;
  }

  const run_ = await profileAll(opts.sources, opts);

  if (opts.command === "profile") {
    const o = profileOptions(opts, run_);
    process.stdout.write(
      opts.json ? `${profileJson(run_.contracts, o)}\n` : formatProfile(run_.contracts, o),
    );
    return 0;
  }

  // save
  //
  // Record the supported line rather than the exact patch version, so a routine
  // toolchain bump inside 0.31.x does not invalidate the budget. Sources are
  // stored relative to the budget file so the pair stays portable.
  const base = dirname(resolve(opts.budget));
  const line = `${run_.toolchain.version.split(".").slice(0, 2).join(".")}.x`;
  const budget = budgetFrom(
    run_.contracts.map((c) => ({ source: relative(base, resolve(c.source)), costs: c.costs })),
    line,
  );
  writeBudget(opts.budget, budget);

  const circuits = run_.contracts.reduce((n, c) => n + c.costs.length, 0);
  process.stdout.write(
    `Wrote ${opts.budget}: ${run_.contracts.length} contract${run_.contracts.length === 1 ? "" : "s"}, ` +
      `${circuits} circuit${circuits === 1 ? "" : "s"}\n` +
      "Check it in, then run `nite-zk check` in CI.\n",
  );
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (e) {
    if (e instanceof ProfilerError) {
      process.stderr.write(`\nerror: ${e.message}\n`);
      if (e.details) process.stderr.write(`\n${e.details}\n`);
      process.stderr.write("\n");
      return 1;
    }
    throw e;
  }
}

// Only self-execute as a CLI, so the module stays importable from tests.
const invokedDirectly =
  process.argv[1] !== undefined &&
  /(?:^|[\\/])(?:cli\.(?:ts|js)|nite-zk)$/.test(process.argv[1]);

if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
