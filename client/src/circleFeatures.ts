import { useEffect, useState } from "react";
import { appConfig } from "./paidCheckout";
import type { CircleFeatureKey } from "./types";

// Which new features are switched on — Circle Experience 2.0 (`circles.*`)
// and Experience 3.0 (`experience.*`) — from the same GET /api/config call
// as the other runtime switches. Display only: the server answers 404 for a
// switched-off feature whatever this says. Unknown or a failed config call
// → everything off, so nothing half-works.

export type CircleFeatures = Record<CircleFeatureKey, boolean>;

export type ExperienceFeatureKey =
  | "experience.smart_match"
  | "experience.go_solo"
  | "experience.collections"
  | "experience.spot_alerts"
  | "experience.adventure_readiness"
  | "experience.programme_journey"
  | "experience.activity_passport"
  | "experience.plan_my_day"
  | "mylife.intent"
  | "mylife.pulse"
  | "mylife.for_you"
  | "mylife.passport_tab"
  | "mylife.alerts";
export type ExperienceFeatures = Record<ExperienceFeatureKey, boolean>;

const CIRCLES_OFF: CircleFeatures = {
  "circles.pulse": false,
  "circles.free_time_match": false,
  "circles.make_it_happen": false,
  "circles.first_time_friendly": false,
  "circles.memories": false,
  "circles.collaboration": false,
  "circles.visitor_experience": false,
};

const EXPERIENCE_OFF: ExperienceFeatures = {
  "experience.smart_match": false,
  "experience.go_solo": false,
  "experience.collections": false,
  "experience.spot_alerts": false,
  "experience.adventure_readiness": false,
  "experience.programme_journey": false,
  "experience.activity_passport": false,
  "experience.plan_my_day": false,
  "mylife.intent": false,
  "mylife.pulse": false,
  "mylife.for_you": false,
  "mylife.passport_tab": false,
  "mylife.alerts": false,
};

export function circleFeatures(): Promise<CircleFeatures> {
  return appConfig().then((d) => ({ ...CIRCLES_OFF, ...(d?.circleFeatures ?? {}) }) as CircleFeatures);
}

export function experienceFeatures(): Promise<ExperienceFeatures> {
  return appConfig().then((d) => ({ ...EXPERIENCE_OFF, ...(d?.experienceFeatures ?? {}) }) as ExperienceFeatures);
}

function useSwitches<T>(initial: T, load: () => Promise<T>): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let live = true;
    load().then((v) => live && setValue(v));
    return () => {
      live = false;
    };
  }, [load]);
  return value;
}

/** All off until the config has loaded. */
export function useCircleFeatures(): CircleFeatures {
  return useSwitches(CIRCLES_OFF, circleFeatures);
}

export function useExperienceFeatures(): ExperienceFeatures {
  return useSwitches(EXPERIENCE_OFF, experienceFeatures);
}

// Participation Expansion Phase 1 — community events, registration options and
// (locked) partial cancellation. Display only, like the others.
export type ParticipationFeatureKey = "participation.events" | "participation.options" | "participation.partial_cancel";
export type ParticipationFeatures = Record<ParticipationFeatureKey, boolean>;
const PARTICIPATION_OFF: ParticipationFeatures = {
  "participation.events": false,
  "participation.options": false,
  "participation.partial_cancel": false,
};
export function participationFeatures(): Promise<ParticipationFeatures> {
  return appConfig().then((d) => ({ ...PARTICIPATION_OFF, ...(d?.participationFeatures ?? {}) }) as ParticipationFeatures);
}
export function useParticipationFeatures(): ParticipationFeatures {
  return useSwitches(PARTICIPATION_OFF, participationFeatures);
}
