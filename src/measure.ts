import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, join } from "node:path";

import { NoProvableCircuitsError, ProfilerError } from "./errors.ts";
import type { Toolchain } from "./toolchain.ts";

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
/** Single file form: `Mock compiling circuit "/abs/path.zkir" (k=9, rows=305)` */
const SINGLE_LINE = /\(k=(\d+),\s*rows=(\d+)\)/;

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

/** Parse the single file form, whose report names the path rather than the circuit. */
export function parseSingle(text: string, circuit: string): Measurement {
  const m = text.match(SINGLE_LINE);
  if (!m) {
    throw new ProfilerError(
      `Could not parse the zkir report for ${circuit}`,
      text.trim() || "(no output)",
    );
  }
  return { circuit, k: Number(m[1]), rows: Number(m[2]) };
}

function zkirFiles(zkirDir: string, source: string): string[] {
  if (!existsSync(zkirDir)) throw new NoProvableCircuitsError(source);
  const files = readdirSync(zkirDir).filter((f) => f.endsWith(".zkir"));
  if (files.length === 0) throw new NoProvableCircuitsError(source);
  return files;
}

/** Measure every circuit in a single sequential `zkir` invocation. */
export function measure(
  zkirDir: string,
  toolchain: Toolchain,
  source: string,
): Measurement[] {
  zkirFiles(zkirDir, source);

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

  return parseReport(output).sort((a, b) => a.circuit.localeCompare(b.circuit));
}

/**
 * Measure every circuit, several at a time.
 *
 * `mock-compile-many` walks the directory sequentially, and its cost is
 * dominated by the largest circuits: on a nine circuit contract it spent 17s,
 * of which one circuit accounted for 5.5s. Running the single file form
 * concurrently cuts that to roughly 9s on eight cores, and each process stays
 * around 58 MB, so the concurrency is bounded by cores rather than memory.
 *
 * The single file report names the path instead of the circuit, but the file is
 * `<circuit>.zkir`, so the name comes from the filename.
 */
export async function measureParallel(
  zkirDir: string,
  toolchain: Toolchain,
  source: string,
  onProgress?: (done: number, total: number) => void,
  concurrency = Math.max(1, availableParallelism()),
): Promise<Measurement[]> {
  const files = zkirFiles(zkirDir, source);
  const results: Measurement[] = [];
  let done = 0;
  let next = 0;

  onProgress?.(0, files.length);

  const runOne = (file: string) =>
    new Promise<Measurement>((resolvePromise, reject) => {
      const child = spawn(toolchain.zkirPath, ["mock-compile", join(zkirDir, file)]);
      let out = "";
      child.stderr.on("data", (d) => (out += d));
      child.stdout.on("data", (d) => (out += d));
      child.on("error", (e) =>
        reject(new ProfilerError(`Could not run ${toolchain.zkirPath}`, String(e))),
      );
      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new ProfilerError(
              `zkir mock-compile failed for ${basename(file, ".zkir")}`,
              out.trim() || `zkir exited with status ${code}`,
            ),
          );
          return;
        }
        try {
          const m = parseSingle(out, basename(file, ".zkir"));
          onProgress?.(++done, files.length);
          resolvePromise(m);
        } catch (e) {
          reject(e);
        }
      });
    });

  const worker = async () => {
    while (next < files.length) {
      results.push(await runOne(files[next++]!));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, () => worker()),
  );

  return results.sort((a, b) => a.circuit.localeCompare(b.circuit));
}
