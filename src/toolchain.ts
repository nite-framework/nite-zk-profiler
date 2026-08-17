import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ProfilerError } from "./errors.ts";

/** Toolchain lines this tool has been verified against. */
export const SUPPORTED_RANGES = ["0.31.x"];

/**
 * The IR major version emitted by supported compilers. The toolchain ships a
 * `zkir` (IR 2.0) and a `zkir-v3` (IR 3.0) side by side with identical CLIs and
 * incompatible formats, so the major version is checked rather than assumed.
 */
const EXPECTED_ZKIR_MAJOR = 2;

export interface Toolchain {
  /** Compiler version, as reported by the compiler itself. */
  version: string;
  /** Absolute path to the `zkir` paired with that compiler. */
  zkirPath: string;
  /** Version string reported by that `zkir` binary. */
  zkirVersion: string;
  /** `+VERSION` selector to pass through to `compact`, when one was requested. */
  versionArg?: string;
}

/** Whether a compiler version is one this tool has been verified against. */
export function isSupported(version: string): boolean {
  return /^0\.31\./.test(version);
}

/** Root holding `versions/`, overridable exactly as the `compact` CLI does. */
export function artifactRoot(): string {
  return process.env.COMPACT_DIRECTORY || join(homedir(), ".compact");
}

/**
 * Ask the compiler which version it is. This honours `+VERSION` and any
 * configured default, so the answer describes the compiler that will actually
 * run rather than whatever happens to be installed.
 */
function detectCompilerVersion(versionArg?: string): string {
  const args = ["compile"];
  if (versionArg) args.push(versionArg);
  args.push("--version");

  const res = spawnSync("compact", args, { encoding: "utf8" });

  if (res.error) {
    throw new ProfilerError(
      "Could not run `compact`",
      "The Compact CLI was not found on your PATH.\n" +
        "Install it, or see https://docs.midnight.network for setup.",
    );
  }

  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  const match = out.match(/^\s*(\d+\.\d+\.\d+)\s*$/m);
  if (!match) {
    const hint = versionArg
      ? `Is ${versionArg.slice(1)} installed? Check with \`compact list\`, ` +
        `and install it with \`compact update ${versionArg.slice(1)}\`.`
      : "No default compiler appears to be set. Set one with `compact update`.";
    throw new ProfilerError(
      "Could not determine the Compact compiler version",
      `${hint}\n\n\`compact compile ${versionArg ?? ""} --version\` returned:\n${out || "(no output)"}`,
    );
  }
  return match[1]!;
}

/** Find the per-target directory inside a version that actually holds `zkir`. */
function findTargetDir(versionDir: string): string {
  let entries: string[];
  try {
    entries = readdirSync(versionDir);
  } catch {
    throw new ProfilerError(
      `Toolchain directory not found: ${versionDir}`,
      "The compiler reported a version with no matching install directory.",
    );
  }

  const hit = entries.find((e) => existsSync(join(versionDir, e, "zkir")));
  if (!hit) {
    throw new ProfilerError(
      `No \`zkir\` binary found under ${versionDir}`,
      "This toolchain version is installed but incomplete. Reinstall it with\n" +
        "`compact update`, and note that a separately installed zkir is never used.",
    );
  }
  return join(versionDir, hit);
}

/** Confirm the binary is the one we think it is, and that it reads IR 2.0. */
function checkZkir(zkirPath: string): string {
  const res = spawnSync(zkirPath, ["--version"], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new ProfilerError(
      `Could not run ${zkirPath}`,
      (res.stderr ?? "").trim() || "The binary exists but did not execute.",
    );
  }

  const reported = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  const match = reported.match(/midnight-zkir\s+(\d+)\.(\d+)\.\S+/);
  if (!match) {
    throw new ProfilerError(
      `Unrecognised zkir version string: ${reported}`,
      "Expected something like `midnight-zkir 2.1.0`.",
    );
  }

  const major = Number(match[1]);
  if (major !== EXPECTED_ZKIR_MAJOR) {
    throw new ProfilerError(
      `Wrong zkir IR version: found ${reported}`,
      `Supported compilers emit IR ${EXPECTED_ZKIR_MAJOR}.0, but this binary reads IR ${major}.0.\n` +
        "Mixing them produces a partial report that looks successful. Refusing to continue.",
    );
  }
  return reported;
}

/**
 * Resolve the compiler and the `zkir` that ships beside it.
 *
 * `zkir` is never taken from PATH and never borrowed from a neighbouring
 * version. If the paired binary is missing that is an error, because a report
 * built from a mismatched IR reader is wrong rather than merely incomplete.
 */
export function resolveToolchain(versionArg?: string): Toolchain {
  const version = detectCompilerVersion(versionArg);

  if (!isSupported(version)) {
    throw new ProfilerError(
      `Unsupported Compact toolchain: ${version}`,
      `This tool supports ${SUPPORTED_RANGES.join(", ")}.\n` +
        "Toolchain lines change zkir internals, so rather than report a number it\n" +
        "cannot stand behind, it stops here.\n" +
        `Pin a supported compiler with: nite-zk profile +0.31.1 <source>`,
    );
  }

  const versionDir = join(artifactRoot(), "versions", version);
  const zkirPath = join(findTargetDir(versionDir), "zkir");
  const zkirVersion = checkZkir(zkirPath);

  return { version, zkirPath, zkirVersion, versionArg };
}
