import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Measurement } from "./measure.ts";
import type { Toolchain } from "./toolchain.ts";
import { toolVersion } from "./version.ts";

/**
 * Measurement cache, keyed on the emitted IR rather than on the source.
 *
 * Compilation is the cheap half: on a nine circuit contract it took 1.1s
 * against 17s to measure. So the compile always runs, and its output is used as
 * the cache key. Identical IR provably yields identical constraint counts, so
 * this cannot go stale in a way that produces a wrong answer, which a source
 * timestamp or a partial import scan could.
 */
export function cacheDir(): string {
  return process.env.NITE_ZK_CACHE || join(tmpdir(), "nite-zk-profiler-cache");
}

/** Hash every emitted IR file, plus the toolchain that produced and reads it. */
export function cacheKey(zkirDir: string, toolchain: Toolchain): string {
  const hash = createHash("sha256");
  // The profiler's own version is part of the key. Without it, upgrading the
  // tool would keep serving results produced by the previous measurement code,
  // which looks exactly like the upgrade having no effect.
  hash.update(toolVersion());
  hash.update(toolchain.version);
  hash.update(toolchain.zkirVersion);

  for (const file of readdirSync(zkirDir).filter((f) => f.endsWith(".zkir")).sort()) {
    hash.update(file);
    hash.update(readFileSync(join(zkirDir, file)));
  }

  return hash.digest("hex").slice(0, 32);
}

export function readCache(key: string): Measurement[] | undefined {
  const file = join(cacheDir(), `${key}.json`);
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as Measurement[]) : undefined;
  } catch {
    // A corrupt entry is not worth failing over; measure again instead.
    return undefined;
  }
}

export function writeCache(key: string, measurements: Measurement[]): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(join(cacheDir(), `${key}.json`), JSON.stringify(measurements), "utf8");
  } catch {
    // Caching is an optimisation. Failing to write one must never fail a run.
  }
}
