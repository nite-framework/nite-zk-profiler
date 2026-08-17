import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { analyze } from "../src/analyze.js";
import { compileSkipZk } from "../src/compile.js";
import { NoProvableCircuitsError, ProfilerError } from "../src/errors.js";
import { measure } from "../src/measure.js";
import { resolveToolchain } from "../src/toolchain.js";

/**
 * These exercise the real toolchain. They are skipped rather than failed when a
 * supported compiler is absent, so the suite still runs on a machine without one.
 */
function supportedToolchainAvailable(): boolean {
  const res = spawnSync("compact", ["compile", "--version"], { encoding: "utf8" });
  return res.status === 0 && /^\s*0\.31\./m.test(`${res.stdout}${res.stderr}`);
}

const available = supportedToolchainAvailable();
const fixture = (name: string) => join(import.meta.dir, "fixtures", name);

describe.if(available)("toolchain resolution", () => {
  test("pairs zkir with the compiler that ran", () => {
    const toolchain = resolveToolchain();
    expect(toolchain.version).toMatch(/^0\.31\./);
    expect(toolchain.zkirVersion).toMatch(/midnight-zkir 2\./);
    // The paired binary lives inside that compiler's own version directory,
    // never on PATH and never borrowed from a neighbouring version.
    expect(toolchain.zkirPath).toContain(join("versions", toolchain.version));
    expect(existsSync(toolchain.zkirPath)).toBe(true);
  });

  test("honours a +VERSION pin", () => {
    const toolchain = resolveToolchain("+0.31.1");
    expect(toolchain.version).toBe("0.31.1");
    expect(toolchain.zkirPath).toContain(join("versions", "0.31.1"));
  });

  test("explains a version pin that is not installed", () => {
    expect(() => resolveToolchain("+0.1.0")).toThrow(
      /Could not determine the Compact compiler version/,
    );
  });
});

describe.if(available)("end to end profiling", () => {
  test("measures every exported circuit", () => {
    const toolchain = resolveToolchain();
    const compiled = compileSkipZk(fixture("Sample.compact"), toolchain);
    try {
      const costs = analyze(measure(compiled.zkirDir, toolchain, "Sample.compact"));
      expect(costs.map((c) => c.circuit)).toEqual(["balanceOf", "register"]);
      for (const cost of costs) {
        expect(cost.rows).toBeGreaterThan(0);
        expect(cost.capacity).toBe(2 ** cost.k);
      }
    } finally {
      compiled.cleanup();
    }
  });

  test("resolves imports across files from a single entry point", () => {
    const toolchain = resolveToolchain();
    const compiled = compileSkipZk(fixture(join("multi", "Main.compact")), toolchain);
    try {
      const costs = analyze(measure(compiled.zkirDir, toolchain, "Main.compact"));
      // The imported helper is inlined into its caller rather than emitting
      // ZKIR of its own, so its cost lands on the circuit that pays for it.
      expect(costs.map((c) => c.circuit)).toEqual(["bumpBy"]);
    } finally {
      compiled.cleanup();
    }
  });

  test("explains a contract with no provable circuits", () => {
    const toolchain = resolveToolchain();
    const compiled = compileSkipZk(fixture("NoCircuits.compact"), toolchain);
    try {
      expect(() => measure(compiled.zkirDir, toolchain, "NoCircuits.compact")).toThrow(
        NoProvableCircuitsError,
      );
    } finally {
      compiled.cleanup();
    }
  });

  test("surfaces compiler diagnostics on a broken contract", () => {
    const dir = mkdtempSync(join(tmpdir(), "nite-zk-test-"));
    const broken = join(dir, "Broken.compact");
    Bun.write(broken, "pragma language_version 0.23;\nthis is not compact;\n");
    try {
      expect(() => compileSkipZk(broken, resolveToolchain())).toThrow(ProfilerError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cleans up its temporary output directory", () => {
    const toolchain = resolveToolchain();
    const compiled = compileSkipZk(fixture("Sample.compact"), toolchain);
    expect(existsSync(compiled.outDir)).toBe(true);
    compiled.cleanup();
    expect(existsSync(compiled.outDir)).toBe(false);
  });

  test("keeps an explicitly requested output directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "nite-zk-out-"));
    const toolchain = resolveToolchain();
    const compiled = compileSkipZk(fixture("Sample.compact"), toolchain, dir);
    try {
      compiled.cleanup();
      expect(existsSync(join(dir, "zkir"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
