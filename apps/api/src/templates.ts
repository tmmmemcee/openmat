/**
 * Everything the setup wizard offers: rule sets, youth age divisions and
 * official weight class presets. Served to the web app so both agree.
 */
import { RULESETS, USAW_KIDS_DIVISIONS, WEIGHT_CLASS_PRESETS } from "@openmat/core";

export function templates() {
  return {
    rulesets: RULESETS.map((r) => ({
      id: r.id,
      name: r.name,
      style: r.style,
      season: r.season,
      periodsSec: r.periodsSec,
      minRestMin: r.minRestMin ?? 30,
      summary: r.summary,
      links: r.links,
    })),
    ageDivisions: USAW_KIDS_DIVISIONS,
    weightClassPresets: WEIGHT_CLASS_PRESETS.map((p) => ({
      name: p.name,
      limits: p.classes.map((c) => c.limit),
      maxClassesUp: p.maxClassesUp,
    })),
  };
}
