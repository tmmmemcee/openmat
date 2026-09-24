/**
 * Official (fixed) weight classes: high school, USAW kids nationals, etc.
 *
 * A wrestler "makes" the lightest class whose limit (plus any allowance) is at
 * or above their weigh-in weight. They may enter that class or wrestle up a
 * limited number of classes (NFHS: one class, Rule 4-4-2). Never down.
 */

export interface WeightClass {
  /** Display name, usually the limit, e.g. "106" or "285". */
  name: string;
  /** Maximum weight for this class. */
  limit: number;
}

export interface WeightClassSet {
  name: string;
  classes: WeightClass[];
  /** How many classes above their natural class a wrestler may enter. */
  maxClassesUp: number;
  source?: string;
}

const set = (name: string, limits: number[], maxClassesUp: number, source?: string): WeightClassSet => ({
  name,
  classes: limits.map((limit) => ({ name: String(limit), limit })),
  maxClassesUp,
  ...(source ? { source } : {}),
});

const NFHS_WEIGHTS_SOURCE =
  "https://nfhs.org/stories/separate-weight-classes-for-girls-choice-of-weight-classes-established-in-high-school-wrestling";
const USAW_KIDS_SOURCE = "https://usawrestlingevents.com/event/2600004702/division";

/**
 * Presets. NFHS lets each state pick a 12, 13 or 14 class set; these are the
 * 14 class sets. Directors can edit any preset.
 */
export const WEIGHT_CLASS_PRESETS: WeightClassSet[] = [
  set("NFHS Boys (14)", [106, 113, 120, 126, 132, 138, 144, 150, 157, 165, 175, 190, 215, 285], 1, NFHS_WEIGHTS_SOURCE),
  set("NFHS Girls (14)", [100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 155, 170, 190, 235], 1, NFHS_WEIGHTS_SOURCE),
  set("USAW Kids 8U Boys", [40, 43, 45, 49, 53, 56, 62, 70, 85], 1, USAW_KIDS_SOURCE),
  set("USAW Kids 8U Girls", [40, 43, 46, 50, 55, 62, 68, 74, 85], 1, USAW_KIDS_SOURCE),
  set("USAW Kids 10U Boys", [49, 53, 56, 59, 63, 67, 71, 77, 84, 93, 105, 120], 1, USAW_KIDS_SOURCE),
  set("USAW Kids 10U Girls", [45, 49, 53, 57, 62, 67, 73, 80, 90, 100, 113], 1, USAW_KIDS_SOURCE),
  set("USAW Kids 12U Boys", [58, 63, 67, 70, 74, 78, 82, 86, 92, 98, 108, 117, 135, 160], 1, USAW_KIDS_SOURCE),
  set("USAW Kids 12U Girls", [55, 59, 64, 69, 75, 81, 87, 94, 102, 112, 126, 140], 1, USAW_KIDS_SOURCE),
  set(
    "USAW Kids 14U Boys",
    [75, 80, 84, 88, 92, 96, 100, 105, 110, 115, 120, 126, 132, 140, 155, 175, 225],
    1,
    USAW_KIDS_SOURCE,
  ),
  set(
    "USAW Kids 14U Girls",
    [75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 150, 165, 180],
    1,
    USAW_KIDS_SOURCE,
  ),
];

function sorted(classes: WeightClass[]): WeightClass[] {
  return [...classes].sort((a, b) => a.limit - b.limit);
}

/**
 * The lightest class the wrestler makes, or undefined if they're over the
 * heaviest limit. `allowance` is added to every limit (e.g. +1 lb on day 2 of
 * a tournament, or a growth allowance).
 */
export function naturalWeightClass(weight: number, classes: WeightClass[], allowance = 0): WeightClass | undefined {
  return sorted(classes).find((c) => weight <= c.limit + allowance);
}

/** Classes the wrestler may enter: their natural class plus up to `maxClassesUp` heavier. */
export function eligibleWeightClasses(weight: number, classSet: WeightClassSet, allowance = 0): WeightClass[] {
  const classes = sorted(classSet.classes);
  const natural = naturalWeightClass(weight, classes, allowance);
  if (!natural) return [];
  const i = classes.indexOf(natural);
  return classes.slice(i, i + 1 + classSet.maxClassesUp);
}

export type WeighInCheck =
  | { status: "ok"; weightClass: WeightClass; classesUp: number }
  | { status: "missed-weight"; declared: WeightClass; suggested: WeightClass; overBy: number }
  | { status: "too-far-up"; declared: WeightClass; natural: WeightClass; maxClassesUp: number }
  | { status: "over-max"; heaviestLimit: number }
  | { status: "unknown-class"; declared: string };

/**
 * Check a weigh-in against the class the wrestler was entered in. Produces a
 * plain answer the weigh-in screen can show, e.g. "Missed 113 by 0.4, move to
 * 120?".
 */
export function checkWeighIn(
  weight: number,
  declaredClassName: string,
  classSet: WeightClassSet,
  allowance = 0,
): WeighInCheck {
  const classes = sorted(classSet.classes);
  const declared = classes.find((c) => c.name === declaredClassName);
  if (!declared) return { status: "unknown-class", declared: declaredClassName };
  const natural = naturalWeightClass(weight, classes, allowance);
  if (!natural) return { status: "over-max", heaviestLimit: classes[classes.length - 1]!.limit + allowance };

  const up = classes.indexOf(declared) - classes.indexOf(natural);
  if (up < 0) {
    return {
      status: "missed-weight",
      declared,
      suggested: natural,
      overBy: Math.round((weight - (declared.limit + allowance)) * 10) / 10,
    };
  }
  if (up > classSet.maxClassesUp) {
    return { status: "too-far-up", declared, natural, maxClassesUp: classSet.maxClassesUp };
  }
  return { status: "ok", weightClass: declared, classesUp: up };
}
