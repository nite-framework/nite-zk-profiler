import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ProfilerError } from "./errors.ts";
import type { Toolchain } from "./toolchain.ts";

export interface CompileResult {
  /** Directory the compiler wrote into. */
  outDir: string;
  /** Directory holding `<circuit>.zkir`, whether or not it exists. */
  zkirDir: string;
  /** Remove the output directory, when this tool created a temporary one. */
  cleanup: () => void;
}

/**
 * Compile without proving keys.
 *
 * `--skip-zk` is what makes profiling fast enough to sit in an edit loop: it
 * emits the IR and skips key generation, which is the slow part.
 */
export function compileSkipZk(
  source: string,
  toolchain: Toolchain,
  outDir?: string,
): CompileResult {
  const temporary = outDir === undefined;
  const target = temporary
    ? mkdtempSync(join(tmpdir(), "nite-zk-"))
    : resolve(outDir);

  const args = ["compile"];
  if (toolchain.versionArg) args.push(toolchain.versionArg);
  args.push("--skip-zk", resolve(source), target);

  const res = spawnSync("compact", args, { encoding: "utf8" });

  const cleanup = () => {
    if (temporary) rmSync(target, { recursive: true, force: true });
  };

  if (res.error) {
    cleanup();
    throw new ProfilerError("Could not run `compact compile`", String(res.error));
  }

  if (res.status !== 0) {
    // The compiler's own diagnostics are better than anything worth inventing
    // here, so they are passed through unchanged.
    const diagnostics = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    cleanup();
    throw new ProfilerError(
      `Compilation failed for ${source}`,
      diagnostics || `compact exited with status ${res.status}`,
    );
  }

  return { outDir: target, zkirDir: join(target, "zkir"), cleanup };
}
