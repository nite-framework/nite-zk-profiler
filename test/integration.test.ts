import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { analyze } from "../src/analyze.ts";
import { compileSkipZk } from "../src/compile.ts";
import { NoProvableCircuitsError, ProfilerError } from "../src/errors.ts";
import { measureParallel } from "../src/measure.ts";
import { resolveToolchain } from "../src/toolchain.ts";

/**
 * These exercise the real toolchain. They are skipped rather than failed when a
 * supported compiler is absent, so the suite still runs on a machine without one.
 */
function supportedToolchainAvailable(): boolean {
  const res = spawnSync("compact", ["compile", "--version"], { encoding: "utf8" });
  return res.status === 0 && /^\s*0\.31\./m.test(`${res.stdout}${res.stderr}`);
}

const skip = supportedToolchainAvailable()
  ? false
  : "no supported Compact toolchain installed";

const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);

describe("toolchain resolution", { skip }, () => {
  it("pairs zkir with the compiler that ran", async () => {
    const toolchain = resolveToolchain();
    assert.match(toolchain.version, /^0\.31\./);
    assert.match(toolchain.zkirVersion, /midnight-zkir 2\./);
    // The paired binary lives inside that compiler's own version directory,
    // never on PATH and never borrowed from a neighbouring version.
    assert.ok(toolchain.zkirPath.includes(join("versions", toolchain.version)));
    assert.ok(existsSync(toolchain.zkirPath));
  });

  it("honours a +VERSION pin", async () => {
    const toolchain = resolveToolchain("+0.31.1");
    assert.equal(toolchain.version, "0.31.1");
    assert.ok(toolchain.zkirPath.includes(join("versions", "0.31.1")));
  });

  it("explains a version pin that is not installed", async () => {
    assert.throws(
      () => resolveToolchain("+0.1.0"),
      /Could not determine the Compact compiler version/,
    );
  });
});

describe("end to end profiling", { skip }, () => {
  it("measures every exported circuit", async () => {
    const toolchain = resolveToolchain();
    const compiled = await compileSkipZk(fixture("Sample.compact"), toolchain);
    try {
      const costs = analyze(await measureParallel(compiled.zkirDir, toolchain, "Sample.compact"));
      assert.deepEqual(
        costs.map((c) => c.circuit),
        ["balanceOf", "register"],
      );
      for (const cost of costs) {
        assert.ok(cost.rows > 0);
        assert.equal(cost.capacity, 2 ** cost.k);
      }
    } finally {
      compiled.cleanup();
    }
  });

  it("resolves imports across files from a single entry point", async () => {
    const toolchain = resolveToolchain();
    const compiled = await compileSkipZk(fixture(join("multi", "Main.compact")), toolchain);
    try {
      const costs = analyze(await measureParallel(compiled.zkirDir, toolchain, "Main.compact"));
      // The imported helper is inlined into its caller rather than emitting
      // ZKIR of its own, so its cost lands on the circuit that pays for it.
      assert.deepEqual(
        costs.map((c) => c.circuit),
        ["bumpBy"],
      );
    } finally {
      compiled.cleanup();
    }
  });

  it("explains a contract with no provable circuits", async () => {
    const toolchain = resolveToolchain();
    const compiled = await compileSkipZk(fixture("NoCircuits.compact"), toolchain);
    try {
      await assert.rejects(
        () => measureParallel(compiled.zkirDir, toolchain, "NoCircuits.compact"),
        NoProvableCircuitsError,
      );
    } finally {
      compiled.cleanup();
    }
  });

  it("surfaces compiler diagnostics on a broken contract", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nite-zk-test-"));
    const broken = join(dir, "Broken.compact");
    writeFileSync(broken, "pragma language_version 0.23;\nthis is not compact;\n");
    try {
      await assert.rejects(() => compileSkipZk(broken, resolveToolchain()), ProfilerError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cleans up its temporary output directory", async () => {
    const toolchain = resolveToolchain();
    const compiled = await compileSkipZk(fixture("Sample.compact"), toolchain);
    assert.ok(existsSync(compiled.outDir));
    compiled.cleanup();
    assert.ok(!existsSync(compiled.outDir));
  });

  it("keeps an explicitly requested output directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nite-zk-out-"));
    const toolchain = resolveToolchain();
    const compiled = await compileSkipZk(fixture("Sample.compact"), toolchain, dir);
    try {
      compiled.cleanup();
      assert.ok(existsSync(join(dir, "zkir")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
