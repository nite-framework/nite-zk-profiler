import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { NoProvableCircuitsError, ProfilerError } from "./errors.js";
import type { Toolchain } from "./toolchain.js";

export interface Measurement {
  circuit: string;
  /** Constraint rows, as reported by zkir. */
  rows: number;
  /** Proving domain exponent, as reported by zkir. Never computed here. */
  k: number;
}

/** `  circuit "name" (k=9, rows=305)` */
const CIRCUIT_LINE = /^\s*circuit\s+"([^"]+)"\s+\(k=(\d+),\s*rows=(\d+)\)\s*$/;
/** `Mock compiling 2 circuits:` */
const HEADER_LINE = /^Mock compiling (\d+) circuits?:/m;

/**
 * Parse a `zkir mock-compile-many` report.
 *
 * Exported for testing, because the failure this guards against is a partial
 * report that reads as a successful one.
 */
export function parseReport(text: string): Measurement[] {
  const measurements: Measurement[] = [];

  for (const line of text.split("\n")) {
    const match = line.match(CIRCUIT_LINE);
    if (match) {
      measurements.push({
        circuit: match[1]!,
        k: Number(match[2]),
        rows: Number(match[3]),
      });
    }
  }

  const header = text.match(HEADER_LINE);
  if (!header) {
    throw new ProfilerError(
      "Could not parse the zkir report",
      `Expected a "Mock compiling N circuits:" header. Got:\n${text.trim() || "(no output)"}`,
    );
  }

  // A truncated run prints the header and some circuits before dying, so the
  // declared count is checked against what was actually parsed.
  const declared = Number(header[1]);
  if (declared !== measurements.length) {
    throw new ProfilerError(
      "Truncated zkir report",
      `zkir said it was compiling ${declared} circuits but only ${measurements.length} were reported.\n` +
        "This usually means the run failed partway through. Refusing to report partial results.",
    );
  }

  return measurements;
}

/**
 * Measure every circuit in one `zkir` invocation.
 *
 * `mock-compile-many` is used rather than per file `mock-compile` because the
 * single file form reports the file path instead of the circuit name, which
 * would leave circuit names to be recovered from filenames.
 */
export function measure(
  zkirDir: string,
  toolchain: Toolchain,
  source: string,
): Measurement[] {
  if (!existsSync(zkirDir)) {
    throw new NoProvableCircuitsError(source);
  }

  const res = spawnSync(toolchain.zkirPath, ["mock-compile-many", zkirDir], {
    encoding: "utf8",
  });

  if (res.error) {
    throw new ProfilerError(`Could not run ${toolchain.zkirPath}`, String(res.error));
  }

  // zkir writes its report to stderr. Reading stdout yields an empty string and
  // a report of zero circuits, which is a silent wrong answer rather than a crash.
  const output = `${res.stderr ?? ""}${res.stdout ?? ""}`;

  if (res.status !== 0) {
    throw new ProfilerError(
      "zkir mock-compile-many failed",
      output.trim() || `zkir exited with status ${res.status}`,
    );
  }

  const measurements = parseReport(output);
  if (measurements.length === 0) {
    throw new NoProvableCircuitsError(source);
  }

  return measurements.sort((a, b) => a.circuit.localeCompare(b.circuit));
}
