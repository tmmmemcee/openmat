import { describe, expect, it } from "vitest";
import { WEIGHT_CLASS_PRESETS, checkWeighIn, eligibleWeightClasses, naturalWeightClass } from "../src/index.js";

const hsBoys = WEIGHT_CLASS_PRESETS.find((s) => s.name === "NFHS Boys (14)")!;

describe("weight classes", () => {
  it("finds the lightest class the wrestler makes", () => {
    expect(naturalWeightClass(106, hsBoys.classes)?.name).toBe("106");
    expect(naturalWeightClass(106.2, hsBoys.classes)?.name).toBe("113");
    expect(naturalWeightClass(106.8, hsBoys.classes, 1)?.name).toBe("106");
    expect(naturalWeightClass(290, hsBoys.classes)).toBeUndefined();
  });

  it("allows one class up under NFHS, never down", () => {
    expect(eligibleWeightClasses(110, hsBoys).map((c) => c.name)).toEqual(["113", "120"]);
    expect(checkWeighIn(110, "120", hsBoys)).toMatchObject({ status: "ok", classesUp: 1 });
    expect(checkWeighIn(110, "126", hsBoys)).toMatchObject({ status: "too-far-up" });
    expect(checkWeighIn(113.4, "113", hsBoys)).toMatchObject({ status: "missed-weight", overBy: 0.4 });
    expect(checkWeighIn(113.4, "113", hsBoys)).toMatchObject({ suggested: { name: "120" } });
    expect(checkWeighIn(300, "285", hsBoys)).toEqual({ status: "over-max", heaviestLimit: 285 });
    expect(checkWeighIn(150, "151", hsBoys)).toEqual({ status: "unknown-class", declared: "151" });
  });
});
