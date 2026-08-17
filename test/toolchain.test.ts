import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSupported } from "../src/toolchain.ts";

describe("isSupported", () => {
  it("accepts the verified 0.31.x line", () => {
    for (const v of ["0.31.0", "0.31.1", "0.31.12"]) {
      assert.equal(isSupported(v), true, v);
    }
  });

  // Toolchain lines change zkir internals, so anything outside the verified
  // range is refused rather than measured with a reader that may not match.
  it("rejects everything else, including newer lines", () => {
    for (const v of ["0.30.0", "0.32.0", "0.33.0", "1.0.0", "0.3.1"]) {
      assert.equal(isSupported(v), false, v);
    }
  });
});
