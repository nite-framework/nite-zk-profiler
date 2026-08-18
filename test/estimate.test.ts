import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MS_PER_DOMAIN_ROW,
  calibrationFrom,
  estimateProvingMs,
  formatDuration,
} from "../src/estimate.ts";

describe("estimateProvingMs", () => {
  // The model is time = rate * 2^k, so each step in k must double the estimate.
  it("doubles per step in k", () => {
    const a = estimateProvingMs(10).ms;
    const b = estimateProvingMs(11).ms;
    assert.equal(b / a, 2);
  });

  it("uses the documented default when uncalibrated", () => {
    assert.equal(estimateProvingMs(10).ms, DEFAULT_MS_PER_DOMAIN_ROW * 1024);
    assert.equal(estimateProvingMs(10).calibrated, false);
  });

  it("reproduces the observation it was calibrated from", () => {
    const c = calibrationFrom(9000, 16);
    const back = estimateProvingMs(16, c);
    assert.equal(Math.round(back.ms), 9000);
    assert.equal(back.calibrated, true);
  });

  it("extrapolates from a calibration across k", () => {
    const c = calibrationFrom(9000, 16);
    assert.equal(Math.round(estimateProvingMs(17, c).ms), 18000);
  });
});

describe("formatDuration", () => {
  it("scales units with magnitude", () => {
    assert.equal(formatDuration(250), "250ms");
    assert.equal(formatDuration(9500), "9.5s");
    assert.equal(formatDuration(125000), "2m5s");
  });
});
