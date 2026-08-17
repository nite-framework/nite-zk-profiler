import { spawn } from "node:child_process";
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
export async function compileSkipZk(
  source: string,
  toolchain: Toolchain,
  outDir?: string,
): Promise<CompileResult> {
  const temporary = outDir === undefined;
  const target = temporary
    ? mkdtempSync(join(tmpdir(), "nite-zk-"))
    : resolve(outDir);

  const args = ["compile"];
  if (toolchain.versionArg) args.push(toolchain.versionArg);
  args.push("--skip-zk", resolve(source), target);

  const cleanup = () => {
    if (temporary) rmSync(target, { recursive: true, force: true });
  };

  // Spawned asynchronously rather than with spawnSync so the event loop stays
  // free. A synchronous spawn blocks timers, which freezes the progress
  // display for the whole compile.
  const { status, output, error } = await new Promise<{
    status: number | null;
    output: string;
    error?: Error;
  }>((resolvePromise) => {
    const child = spawn("compact", args);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => resolvePromise({ status: null, output: out, error: e }));
    child.on("close", (code) => resolvePromise({ status: code, output: out }));
  });

  if (error) {
    cleanup();
    throw new ProfilerError("Could not run `compact compile`", String(error));
  }

  if (status !== 0) {
    // The compiler's own diagnostics are better than anything worth inventing
    // here, so they are passed through unchanged.
    cleanup();
    throw new ProfilerError(
      `Compilation failed for ${source}`,
      output.trim() || `compact exited with status ${status}`,
    );
  }

  return { outDir: target, zkirDir: join(target, "zkir"), cleanup };
}
