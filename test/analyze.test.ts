import { describe, expect, test } from "bun:test";

import { analyze } from "../src/analyze.js";

describe("analyze", () => {
  test("derives capacity from the reported k", () => {
    const [cost] = analyze([{ circuit: "a", k: 9, rows: 305 }]);
    expect(cost!.capacity).toBe(512);
  });

  test("scales relative cost against the cheapest circuit", () => {
    const costs = analyze([
      { circuit: "bump", k: 5, rows: 24 },
      { circuit: "hashy", k: 13, rows: 4189 },
    ]);
    expect(costs.map((c) => c.relativeCost)).toEqual([1, 256]);
  });

  // k is read from zkir, never recomputed. These are real measurements where a
  // ceil(log2(rows)) formula would disagree with the reported k.
  test("passes k through unchanged even when rows would imply otherwise", () => {
    const costs = analyze([
      { circuit: "bump", k: 5, rows: 24 },
      { circuit: "manyIncrements", k: 7, rows: 24 },
      { circuit: "justCompare", k: 9, rows: 119 },
      { circuit: "justAdd", k: 8, rows: 191 },
    ]);
    expect(costs.map((c) => c.k)).toEqual([5, 7, 9, 8]);
    expect(costs.map((c) => c.capacity)).toEqual([32, 128, 512, 256]);
  });

  test("returns nothing for no measurements", () => {
    expect(analyze([])).toEqual([]);
  });
});
