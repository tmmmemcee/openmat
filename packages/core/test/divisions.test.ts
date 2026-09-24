import { describe, expect, it } from "vitest";
import { USAW_KIDS_DIVISIONS, effectiveDivision, nativeDivision } from "../src/index.js";

describe("age divisions", () => {
  it("matches USAW 2026 birth years", () => {
    const div = (y: number) => nativeDivision(y, 2026, USAW_KIDS_DIVISIONS)?.name;
    expect(div(2019)).toBe("8U");
    expect(div(2018)).toBe("8U");
    expect(div(2017)).toBe("10U");
    expect(div(2016)).toBe("10U");
    expect(div(2014)).toBe("12U");
    expect(div(2012)).toBe("14U");
    expect(div(2011)).toBeUndefined();
  });

  it("bumps up but never down", () => {
    expect(effectiveDivision("8U", 1, USAW_KIDS_DIVISIONS)?.name).toBe("10U");
    expect(effectiveDivision("14U", 1, USAW_KIDS_DIVISIONS)).toBeUndefined();
    expect(() => effectiveDivision("10U", -1, USAW_KIDS_DIVISIONS)).toThrow(/only move up/);
  });
});
