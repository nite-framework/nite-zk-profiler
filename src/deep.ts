import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProfilerError } from "./errors.ts";
import type { Measurement } from "./measure.ts";
import type { Toolchain } from "./toolchain.ts";

export interface DeepMeasurement extends Measurement {
  /** Wall clock time to generate the proving and verifying keys, in ms. */
  setupMs: number;
  /** Size of the generated prover key, in bytes. */
  proverKeyBytes: number;
}

/**
 * Generate real proving keys and measure how long it takes.
 *
 * This is the expensive counterpart to `mock-compile`. It is opt in because it
 * does the work the fast path deliberately skips, which is minutes rather than
 * seconds on a contract full of high `k` circuits.
 *
 * Two things come out of it that cannot be derived from `k` alone: the actual
 * setup time on this machine, and the prover key size, which is what users end
 * up downloading and holding in memory.
 */
export function measureDeep(
  measurements: Measurement[],
  zkirDir: string,
  toolchain: Toolchain,
  onProgress?: (circuit: string, index: number, total: number) => void,
): DeepMeasurement[] {
  const workDir = mkdtempSync(join(tmpdir(), "nite-zk-keys-"));
  const results: DeepMeasurement[] = [];

  try {
    measurements.forEach((m, i) => {
      onProgress?.(m.circuit, i, measurements.length);

      const irFile = join(zkirDir, `${m.circuit}.zkir`);
      const pk = join(workDir, `${m.circuit}.pk`);
      const vk = join(workDir, `${m.circuit}.vk`);

      const started = performance.now();
      const res = spawnSync(toolchain.zkirPath, ["compile", irFile, pk, vk], {
        encoding: "utf8",
      });
      const setupMs = performance.now() - started;

      if (res.status !== 0) {
        throw new ProfilerError(
          `Key generation failed for ${m.circuit}`,
          (res.stderr ?? "").trim() || `zkir compile exited with ${res.status}`,
        );
      }

      results.push({
        ...m,
        setupMs,
        proverKeyBytes: statSync(pk).size,
      });
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  return results;
}

/** Human readable byte size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human readable duration. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
