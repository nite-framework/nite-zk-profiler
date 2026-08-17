import { describe, expect, test } from "bun:test";

import { isSupported } from "../src/toolchain.js";

describe("isSupported", () => {
  test("accepts the verified 0.31.x line", () => {
    for (const v of ["0.31.0", "0.31.1", "0.31.12"]) {
      expect(isSupported(v)).toBe(true);
    }
  });

  // Toolchain lines change zkir internals, so anything outside the verified
  // range is refused rather than measured with a reader that may not match.
  test("rejects everything else, including newer lines", () => {
    for (const v of ["0.30.0", "0.32.0", "0.33.0", "1.0.0", "0.3.1"]) {
      expect(isSupported(v)).toBe(false);
    }
  });
});
