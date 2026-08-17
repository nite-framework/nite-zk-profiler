#!/usr/bin/env node
import { dirname, isAbsolute, resolve } from "node:path";

import { analyze } from "./analyze.ts";
import {
  DEFAULT_BUDGET_PATH,
  budgetFrom,
  check,
  readBudget,
  writeBudget,
} from "./budget.ts";
import { cacheKey, readCache, writeCache } from "./cache.ts";
import { setColorEnabled } from "./colors.ts";
import { Progress } from "./progress.ts";
import { compileSkipZk } from "./compile.ts";
import { type DeepByCircuit, checkJson, formatCheck, formatProfile, profileJson } from "./report.ts";
import { measureDeep } from "./deep.ts";
import { ProfilerError } from "./errors.ts";
import { measureParallel } from "./measure.ts";
import { SUPPORTED_RANGES, resolveToolchain } from "./toolchain.ts";
import { toolVersion } from "./version.ts";

const USAGE = `nite-zk - see what a Compact circuit costs to prove

Usage:
  nite-zk profile <source>     Report rows, k and relative cost per circuit
  nite-zk save <source>        Write zk-budget.json from current measurements
  nite-zk check [<source>]     Compare against zk-budget.json
                               The source is optional once saved, since the
                               budget records which contract it describes.

Options:
  --deep                       Also generate real proving keys and report setup
                               time and prover key size. Accurate, and slow.
  --json                       Machine readable output
  --out <dir>                  Compile into a specific directory (kept)
  --budget <file>              Budget path (default: ${DEFAULT_BUDGET_PATH})
  --strict                     check: fail on circuits missing from the budget
  --no-color                   Plain output (also honours NO_COLOR)
  --no-cache                   Ignore cached measurements for this run
  +VERSION                     Pin the Compact toolchain, e.g. +0.31.1
  -h, --help                   Show this message
  -v, --version                Show the tool version

Supported Compact toolchains: ${SUPPORTED_RANGES.join(", ")}
`;

interface Options {
  command?: string;
  source?: string;
  json: boolean;
  strict: boolean;
  deep: boolean;
  noColor: boolean;
  noCache: boolean;
  out?: string;
  budget: string;
  versionArg?: string;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    json: false,
    strict: false,
    deep: false,
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
    else if (arg === "--no-color") opts.noColor = true;
    else if (arg === "--no-cache") opts.noCache = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "-v" || arg === "--version") opts.version = true;
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--budget") opts.budget = argv[++i] ?? DEFAULT_BUDGET_PATH;
    else if (arg.startsWith("+")) opts.versionArg = arg;
    else if (!opts.command) opts.command = arg;
    else if (!opts.source) opts.source = arg;
  }

  return opts;
}

/** Compile and measure. Shared by all three commands. */
async function profileSource(source: string, opts: Options) {
  // Monotonic, so a wall clock adjustment mid run cannot produce a negative
  // or wildly wrong duration.
  const started = performance.now();
  const quiet = opts.json;
  const progress = new Progress(!quiet);

  progress.start("resolving toolchain");
  const toolchain = resolveToolchain(opts.versionArg);

  progress.update("compiling without proving keys");
  const compiled = await compileSkipZk(source, toolchain, opts.out);

  try {
    // The compile is the cheap half, so it always runs and its output keys the
    // cache. Identical IR cannot produce different constraint counts.
    const key = opts.noCache ? undefined : cacheKey(compiled.zkirDir, toolchain);
    let measurements = key ? readCache(key) : undefined;
    const cached = measurements !== undefined;

    if (!measurements) {
      progress.update("measuring circuits");
      measurements = await measureParallel(compiled.zkirDir, toolchain, source, (d, t) =>
        progress.update(`measuring circuits  ${d}/${t}`),
      );
      if (key) writeCache(key, measurements);
    }

    const costs = analyze(measurements);

    let deep: DeepByCircuit | undefined;
    if (opts.deep) {
      const results = await measureDeep(measurements, compiled.zkirDir, toolchain, (c, i, n) =>
        progress.update(`generating proving keys  ${i + 1}/${n}  ${c}`),
      );
      deep = new Map(results.map((r) => [r.circuit, r]));
    }

    progress.stop();
    return { costs, toolchain, deep, cached, elapsedMs: performance.now() - started };
  } finally {
    progress.stop();
    compiled.cleanup();
  }
}

/**
 * Work out which contract to measure for `check`.
 *
 * An explicit argument wins. Otherwise fall back to the path recorded when the
 * budget was saved, resolved relative to the budget file so the command works
 * from any directory.
 */
function resolveCheckSource(opts: Options, recorded: string | undefined): string {
  if (opts.source) return opts.source;

  if (!recorded) {
    throw new ProfilerError(
      "check needs a source file",
      `${opts.budget} does not record which contract it describes.\n` +
        "Either pass the contract:\n" +
        "    nite-zk check src/Main.compact\n" +
        "or rewrite the budget so it remembers:\n" +
        "    nite-zk save src/Main.compact",
    );
  }

  return isAbsolute(recorded) ? recorded : resolve(dirname(resolve(opts.budget)), recorded);
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

  if (!["profile", "save", "check"].includes(opts.command)) {
    process.stderr.write(`Unknown command: ${opts.command}\n\n${USAGE}`);
    return 1;
  }

  if (opts.command !== "check" && !opts.source) {
    throw new ProfilerError(
      `${opts.command} needs a source file`,
      `    nite-zk ${opts.command} src/Main.compact`,
    );
  }

  if (opts.command === "check") {
    // Read the budget first, so a missing one is reported before spending time
    // on a compile, and so it can supply the source path.
    const budget = readBudget(opts.budget);
    const source = resolveCheckSource(opts, budget.source);
    const { costs } = await profileSource(source, opts);
    const result = check(costs, budget, opts.strict);
    process.stdout.write(opts.json ? `${checkJson(result)}\n` : formatCheck(result));
    return result.failed ? 1 : 0;
  }

  const { costs, toolchain, deep, cached, elapsedMs } = await profileSource(opts.source!, opts);

  if (opts.command === "profile") {
    process.stdout.write(
      opts.json
        ? `${profileJson(costs, toolchain, deep)}\n`
        : formatProfile(costs, toolchain, elapsedMs, deep, cached),
    );
    return 0;
  }

  // save
  //
  // Record the supported line rather than the exact patch version, so a routine
  // toolchain bump inside 0.31.x does not invalidate the budget. The source is
  // stored relative to the budget file so the pair stays portable.
  const line = `${toolchain.version.split(".").slice(0, 2).join(".")}.x`;
  const budget = budgetFrom(costs, line, opts.source!);
  writeBudget(opts.budget, budget);
  process.stdout.write(
    `Wrote ${opts.budget} with ${costs.length} circuit${costs.length === 1 ? "" : "s"}\n` +
      `Check it in, then run \`nite-zk check\` in CI.\n`,
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
