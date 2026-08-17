#!/usr/bin/env node
import { analyze } from "./analyze.js";
import {
  DEFAULT_BUDGET_PATH,
  budgetFrom,
  check,
  readBudget,
  writeBudget,
} from "./budget.js";
import { compileSkipZk } from "./compile.js";
import { ProfilerError } from "./errors.js";
import { measure } from "./measure.js";
import { checkJson, formatCheck, formatProfile, profileJson } from "./report.js";
import { SUPPORTED_RANGES, resolveToolchain } from "./toolchain.js";

const USAGE = `nite-zk - see what a Compact circuit costs to prove

Usage:
  nite-zk profile <source>     Report rows, k and relative cost per circuit
  nite-zk save <source>        Write zk-budget.json from current measurements
  nite-zk check <source>       Measure and compare against zk-budget.json

Options:
  --json                       Machine readable output
  --out <dir>                  Compile into a specific directory (kept)
  --budget <file>              Budget path (default: ${DEFAULT_BUDGET_PATH})
  --strict                     check: fail on circuits missing from the budget
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
    budget: DEFAULT_BUDGET_PATH,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--json") opts.json = true;
    else if (arg === "--strict") opts.strict = true;
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
function profileSource(source: string, opts: Options) {
  const started = Date.now();
  const toolchain = resolveToolchain(opts.versionArg);
  const compiled = compileSkipZk(source, toolchain, opts.out);

  try {
    const costs = analyze(measure(compiled.zkirDir, toolchain, source));
    return { costs, toolchain, elapsedMs: Date.now() - started };
  } finally {
    compiled.cleanup();
  }
}

export function run(argv: string[]): number {
  const opts = parseArgs(argv);

  if (opts.help || !opts.command) {
    process.stdout.write(USAGE);
    return opts.command ? 0 : 1;
  }

  if (opts.version) {
    process.stdout.write("nite-zk-profiler 0.1.0\n");
    return 0;
  }

  if (!["profile", "save", "check"].includes(opts.command)) {
    process.stderr.write(`Unknown command: ${opts.command}\n\n${USAGE}`);
    return 1;
  }

  if (!opts.source) {
    process.stderr.write(`${opts.command} needs a source file\n\n${USAGE}`);
    return 1;
  }

  const { costs, toolchain, elapsedMs } = profileSource(opts.source, opts);

  if (opts.command === "profile") {
    process.stdout.write(
      opts.json
        ? `${profileJson(costs, toolchain)}\n`
        : formatProfile(costs, toolchain, elapsedMs),
    );
    return 0;
  }

  if (opts.command === "save") {
    // Record the supported line rather than the exact patch version, so a
    // routine toolchain bump inside 0.31.x does not invalidate the budget.
    const budget = budgetFrom(costs, `${toolchain.version.split(".").slice(0, 2).join(".")}.x`);
    writeBudget(opts.budget, budget);
    process.stdout.write(
      `Wrote ${opts.budget} with ${costs.length} circuit${costs.length === 1 ? "" : "s"}\n`,
    );
    return 0;
  }

  const result = check(costs, readBudget(opts.budget), opts.strict);
  process.stdout.write(opts.json ? `${checkJson(result)}\n` : formatCheck(result));
  return result.failed ? 1 : 0;
}

export function main(argv: string[]): number {
  try {
    return run(argv);
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
  process.exit(main(process.argv.slice(2)));
}
