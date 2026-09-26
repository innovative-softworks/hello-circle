import { getSetting, setSetting } from "./db/index.js";

// Recommendation weights (community participation upgrade, Release 4) —
// configurable at runtime from the admin dashboard (app_settings), never
// hardcoded at call sites. Defaults are the brief's own split, summing to
// 100. Each weight is the most that signal can contribute to a fit score.

export const WEIGHT_KEYS = ["interest", "availability", "distance", "goal", "social", "budget", "circle"] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];
export type RecommendationWeights = Record<WeightKey, number>;

export const DEFAULT_WEIGHTS: RecommendationWeights = {
  interest: 30,
  availability: 25,
  distance: 15,
  goal: 10,
  social: 10,
  budget: 5,
  circle: 5,
};

const SETTING_KEY = "recommendation_weights";

/** Only known keys, each a finite number 0–100; anything else is rejected. */
export function validateWeights(input: unknown): RecommendationWeights | null {
  if (!input || typeof input !== "object") return null;
  const out = { ...DEFAULT_WEIGHTS };
  for (const key of WEIGHT_KEYS) {
    const v = (input as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) return null;
    out[key] = v;
  }
  return out;
}

export async function getRecommendationWeights(): Promise<RecommendationWeights> {
  try {
    return validateWeights(JSON.parse(await getSetting(SETTING_KEY, "{}"))) ?? DEFAULT_WEIGHTS;
  } catch {
    return DEFAULT_WEIGHTS;
  }
}

export async function setRecommendationWeights(weights: RecommendationWeights): Promise<void> {
  await setSetting(SETTING_KEY, JSON.stringify(weights));
}
