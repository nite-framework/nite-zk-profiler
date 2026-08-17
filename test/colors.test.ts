import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { costColor, setColorEnabled, visibleLength } from "../src/colors.ts";

describe("visibleLength", () => {
  it("ignores escape sequences so columns line up", () => {
    setColorEnabled(true);
    const painted = costColor(1)("1x");
    assert.ok(painted.length > 2, "expected escape codes to be present");
    assert.equal(visibleLength(painted), 2);
    setColorEnabled(false);
  });

  it("matches plain length for unstyled text", () => {
    assert.equal(visibleLength("balanceOf"), 9);
  });
});

describe("costColor", () => {
  it("escalates with relative cost", () => {
    setColorEnabled(true);
    const codeOf = (n: number) => costColor(n)("x").match(/\[(\d+)/)?.[1];
    // green, yellow, red, bold red
    assert.equal(codeOf(1), "32");
    assert.equal(codeOf(4), "33");
    assert.equal(codeOf(16), "31");
    assert.equal(codeOf(256), "1");
    setColorEnabled(false);
  });

  it("emits nothing when colour is disabled", () => {
    setColorEnabled(false);
    assert.equal(costColor(256)("1x"), "1x");
  });
});
