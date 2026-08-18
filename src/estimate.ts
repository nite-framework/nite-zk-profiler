import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/*
 * There is deliberately no key size prediction here.
 *
 * Key size looked predictable from k: three unrelated circuits at k=13 agreed
 * within 0.11%, and a synthetic k=15 circuit matched a production one to 0.08%.
 * It does not hold. At k=16 a production circuit produced 19,524,757 bytes and
 * a synthetic one 38,513,181, a factor of two apart, with identical verifier
 * key sizes.
 *
 * The likely cause is the extended evaluation domain, which Halo2 sizes by
 * maximum gate degree. That is not reported by mock-compile, so from k alone
 * there is no way to tell which case a circuit is in. A figure that is exact
 * at one k and 2x wrong at the next is worse than no figure, so key size comes
 * only from --deep, where it is measured.
 */

/**
 * Proving cost model.
 *
 * A Halo2 proof is dominated by FFTs and multi scalar multiplications over the
 * full 2^k domain, so the work is proportional to 2^k up to a log factor that
 * is small across the range circuits actually occupy. That gives
 *
 *     time = msPerDomainRow * 2^k
 *
 * with a single machine dependent constant.
 *
 * The default constant is anchored on measured key generation, which performs
 * comparable domain work on the same machine: 10547ms at k=15, so
 * 10547 / 2^15 = 0.322 ms per domain row. Proving is not key generation, so
 * treat the default as an order of magnitude, and calibrate to make it real.
 */
export const DEFAULT_MS_PER_DOMAIN_ROW = 0.322;

export interface Calibration {
  msPerDomainRow: number;
  /** What the number came from, so a stale calibration can be recognised. */
  observedMs: number;
  observedK: number;
  recordedAt: string;
}

export interface ProvingEstimate {
  ms: number;
  calibrated: boolean;
}

export function estimateProvingMs(k: number, calibration?: Calibration): ProvingEstimate {
  const rate = calibration?.msPerDomainRow ?? DEFAULT_MS_PER_DOMAIN_ROW;
  return { ms: rate * 2 ** k, calibrated: calibration !== undefined };
}

/** Turn one observed proof into the machine constant. */
export function calibrationFrom(observedMs: number, observedK: number): Calibration {
  return {
    msPerDomainRow: observedMs / 2 ** observedK,
    observedMs,
    observedK,
    recordedAt: new Date().toISOString(),
  };
}

export function calibrationPath(budgetPath: string): string {
  return join(dirname(budgetPath), ".nite-zk-calibration.json");
}

export function readCalibration(budgetPath: string): Calibration | undefined {
  const file = calibrationPath(budgetPath);
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Calibration;
    return typeof parsed.msPerDomainRow === "number" && parsed.msPerDomainRow > 0
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeCalibration(budgetPath: string, calibration: Calibration): void {
  const file = calibrationPath(budgetPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(calibration, null, 2)}\n`, "utf8");
}

/** Human readable duration, for estimates that span milliseconds to minutes. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

/** Human readable byte size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
