import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyze } from "../src/analyze.ts";

describe("analyze", () => {
  it("derives capacity from the reported k", () => {
    const [cost] = analyze([{ circuit: "a", k: 9, rows: 305 }]);
    assert.equal(cost!.capacity, 512);
  });

  it("scales relative cost against the cheapest circuit", () => {
    const costs = analyze([
      { circuit: "bump", k: 5, rows: 24 },
      { circuit: "hashy", k: 13, rows: 4189 },
    ]);
    assert.deepEqual(
      costs.map((c) => c.relativeCost),
      [1, 256],
    );
  });

  // k is read from zkir, never recomputed. These are real measurements where a
  // ceil(log2(rows)) formula would disagree with the reported k.
  it("passes k through unchanged even when rows would imply otherwise", () => {
    const costs = analyze([
      { circuit: "bump", k: 5, rows: 24 },
      { circuit: "manyIncrements", k: 7, rows: 24 },
      { circuit: "justCompare", k: 9, rows: 119 },
      { circuit: "justAdd", k: 8, rows: 191 },
    ]);
    assert.deepEqual(
      costs.map((c) => c.k),
      [5, 7, 9, 8],
    );
    assert.deepEqual(
      costs.map((c) => c.capacity),
      [32, 128, 512, 256],
    );
  });

  it("returns nothing for no measurements", () => {
    assert.deepEqual(analyze([]), []);
  });
});
