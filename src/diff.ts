import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import type { CircuitCost } from "./analyze.ts";
import { ProfilerError } from "./errors.ts";

export interface DiffRow {
  circuit: string;
  /** Absent when the circuit does not exist on the base ref. */
  before?: number;
  /** Absent when the circuit was removed. */
  after?: number;
}

export interface DiffResult {
  ref: string;
  rows: DiffRow[];
  /** True when any circuit costs more than it did on the base ref. */
  regressed: boolean;
}

function git(args: string[], cwd?: string) {
  const res = spawnSync("git", args, { encoding: "utf8", cwd });
  return { status: res.status, out: `${res.stdout ?? ""}`.trim(), err: `${res.stderr ?? ""}`.trim() };
}

/** Repository root, so ref paths can be resolved the way git sees them. */
export function repoRoot(): string {
  const res = git(["rev-parse", "--show-toplevel"]);
  if (res.status !== 0) {
    throw new ProfilerError(
      "Not a git repository",
      "`nite-zk diff` compares against a git ref, so it needs to run inside a repository.",
    );
  }
  return res.out;
}

function assertRefExists(ref: string): void {
  if (git(["rev-parse", "--verify", `${ref}^{commit}`]).status !== 0) {
    throw new ProfilerError(
      `Unknown git ref: ${ref}`,
      "Pass a branch, tag or commit that exists, for example `nite-zk diff main`.",
    );
  }
}

/**
 * Materialise a ref into a temporary directory.
 *
 * `git archive` is used rather than a worktree or a checkout, because it never
 * touches the working tree or the index. Profiling a branch must not disturb
 * uncommitted work.
 */
export async function materialise(ref: string): Promise<{ dir: string; cleanup: () => void }> {
  assertRefExists(ref);
  const dir = mkdtempSync(join(tmpdir(), "nite-zk-diff-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });

  const status = await new Promise<number | null>((resolvePromise) => {
    const archive = spawn("git", ["archive", "--format=tar", ref]);
    const untar = spawn("tar", ["-x", "-C", dir]);
    archive.stdout.pipe(untar.stdin);
    let failed = "";
    archive.stderr.on("data", (d) => (failed += d));
    untar.on("close", (code) => resolvePromise(code));
    archive.on("error", () => resolvePromise(null));
  });

  if (status !== 0) {
    cleanup();
    throw new ProfilerError(
      `Could not export ${ref}`,
      "git archive failed. Check the ref is reachable from this repository.",
    );
  }

  return { dir, cleanup };
}

/** Where a working tree path lives inside the exported ref. */
export function pathWithinRef(source: string, root: string, refDir: string): string {
  return join(refDir, relative(root, resolve(source)));
}

export function diffCosts(ref: string, before: CircuitCost[], after: CircuitCost[]): DiffResult {
  const beforeK = new Map(before.map((c) => [c.circuit, c.k]));
  const afterK = new Map(after.map((c) => [c.circuit, c.k]));
  const names = [...new Set([...beforeK.keys(), ...afterK.keys()])].sort();

  const rows: DiffRow[] = names.map((circuit) => ({
    circuit,
    before: beforeK.get(circuit),
    after: afterK.get(circuit),
  }));

  const regressed = rows.some(
    (r) => r.before !== undefined && r.after !== undefined && r.after > r.before,
  );

  return { ref, rows, regressed };
}
