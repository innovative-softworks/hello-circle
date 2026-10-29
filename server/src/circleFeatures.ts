import type { NextFunction, Request, Response } from "express";
import { getSetting, setSetting } from "./db/index.js";

// Feature switches for the new resident-facing capabilities — Circle
// Experience 2.0 (`circles.*`) and Experience 3.0 (`experience.*`). One
// runtime switch per capability, stored in app_settings like every other
// switch (no redeploy to change). Default OFF until verified; the default
// lives only here. The client reads the states from GET /api/config to hide
// entry points, but the routes are the enforcement point: a switched-off
// feature answers 404.

export interface FeatureSwitch {
  key: string;
  group: "circles" | "experience" | "participation";
  label: string;
  description: string;
  /** Can't be switched on from admin Settings until the owner approves it. */
  locked?: boolean;
}

export const FEATURE_SWITCHES: FeatureSwitch[] = [
  { key: "circles.pulse", group: "circles", label: "Circle Pulse", description: "Members say what they'd like to do this week or next; everyone else sees totals, never names." },
  { key: "circles.free_time_match", group: "circles", label: "Free Time Match", description: "Members can share when they're free this week or next, for their Circle only. Shows how many are free at the same time, never who." },
  { key: "circles.make_it_happen", group: "circles", label: "Make it happen", description: "Members say \"I'm in\" on suggested plans; organisers see when a plan has enough interest and turn it into an activity through the normal activity form." },
  { key: "circles.first_time_friendly", group: "circles", label: "First-time friendly", description: "A welcome step after joining a Circle, and what-to-expect guidance before its next activity." },
  { key: "circles.memories", group: "circles", label: "Circle Memories", description: "People who took part in a past Circle activity can add photos and short reflections. Members only." },
  { key: "circles.collaboration", group: "circles", label: "Circle-to-Circle activities", description: "An organiser can propose a shared activity with another Circle; both Circles' organisers must agree before it's created. No members or data are merged." },
  { key: "circles.visitor_experience", group: "circles", label: "Circle visitor page", description: "People who aren't members see a welcoming Circle page: highlights, what happens, upcoming activities, the organiser and how to join. Members keep the usual Circle Home." },
  { key: "experience.smart_match", group: "experience", label: "Find something for me", description: "Free Time Mode also asks when, budget and whether you're going alone, explains each suggestion, and offers \"Surprise me\" one real suggestion at a time." },
  { key: "experience.go_solo", group: "experience", label: "Going solo", description: "An \"I'm going solo\" choice that only shows listings whose host said people come on their own or first-timers are welcome." },
  { key: "experience.collections", group: "experience", label: "Collections and occasions", description: "Explore shows collections (Free, Under €20, Beginner-friendly, Family day, This weekend) built only from real listings and host-set attributes; empty ones are hidden." },
  { key: "experience.spot_alerts", group: "experience", label: "Spot alerts", description: "On a full experience or adventure departure, people can ask to be told if a place opens. No place is held; it's re-checked before anyone is told." },
  { key: "experience.adventure_readiness", group: "experience", label: "Get ready", description: "Booked experiences show the organiser's meeting point, kit, fitness, safety and weather notes, with calendar and directions." },
  { key: "experience.programme_journey", group: "experience", label: "Programme journey", description: "Programme bookings show each session as attended, missed, not recorded or upcoming — only from the organiser's registers." },
  { key: "experience.activity_passport", group: "experience", label: "Activity Passport", description: "A private timeline in My Life of things you actually took part in, with first-time milestones. Never shared." },
  { key: "experience.plan_my_day", group: "experience", label: "Plan My Day", description: "Suggests a realistic day of real listings with rough travel estimates, which you can save and edit. Each item is booked separately; nothing is reserved." },
  // My Life 3.0 (owner 2026-10-25, docs/my-life-3/). Same catalogue and admin screen.
  { key: "mylife.intent", group: "experience", label: "My Life: What are you up for?", description: "A three-question form on My Life (what, when, who) that shows real listings from Free Time Mode's matching. No new search." },
  { key: "mylife.pulse", group: "experience", label: "My Life: Pulse", description: "The three most relevant updates on My Life: things that need an answer first, then unread Circle chats and new sessions from people you follow. Suggestions can be dismissed." },
  { key: "mylife.for_you", group: "experience", label: "My Life: Made for your week", description: "Personal suggestions on My Life and a For Me page, from the existing For you ranking with its reasons. Suggestions can be dismissed." },
  { key: "mylife.passport_tab", group: "experience", label: "My Life: Passport tab", description: "Shows the Activity Passport as a My Life tab. Needs the Activity Passport switch too." },
  { key: "mylife.alerts", group: "experience", label: "My Life: alerts", description: "People who opt in get an in-app note when something they saved has a new session, and the evening before a routine day with matching sessions. Off for everyone until they opt in." },
  // Participation Expansion Phase 1 (docs/participation-expansion/07). Read
  // paths are never switched off: orders already placed with options stay
  // visible, cancellable and refundable whatever these say.
  { key: "participation.events", group: "participation", label: "Community events", description: "Partners can create community events (cultural, faith and community celebrations). Events appear in search, filters and category pages. Paid events still go through the normal payment gates." },
  { key: "participation.options", group: "participation", label: "Registration options", description: "Partners can sell several registration options on one experience or event (for example Pooja €71 and Darshan €11), each with its own price, head count and limit. People choose options when they book." },
  { key: "participation.partial_cancel", group: "participation", label: "Remove a person from a booking", description: "People can remove someone from a booking with registration options and get that person's share back. Locked until the owner approves it.", locked: true },
  // Participation Phase 2 (docs/participation-expansion/11, 12). Read paths stay
  // on: attendee details, answers and check-ins already recorded stay visible.
  { key: "participation.attendees", group: "participation", label: "Attendee details and questions", description: "People say who is coming (adult or child, and who looks after each child) and answer the organiser's registration questions when they book. Partners build the questions and see the attendee list." },
  { key: "participation.checkin", group: "participation", label: "Door check-in", description: "Partners check people in one by one at the door, by scanning the pass or searching by name, including part of a group. Check-in-only staff can be assigned to an event or one date." },
  // Phase K (docs/participation-expansion/20) — off until the owner turns it on.
  { key: "participation.reminders", group: "participation", label: "Booking reminders", description: "Signed-in people get an in-app reminder (and a push on the app) the day before an event, experience, hall booking or programme session, with where to go and whether the organiser is still waiting for answers. Respects each person's Booking reminders setting." },
  { key: "participation.special_category_questions", group: "participation", label: "Sensitive registration questions", description: "Questions about health, religion, ethnicity or other special-category data. Locked until a privacy policy for them is approved.", locked: true },
];

/** Thrown when someone tries to switch on a locked switch. */
export class LockedFeatureError extends Error {}

/** Circle Experience 2.0 subset — kept for existing callers. */
export const CIRCLE_FEATURES = FEATURE_SWITCHES.filter((f) => f.group === "circles");
export const EXPERIENCE_FEATURES = FEATURE_SWITCHES.filter((f) => f.group === "experience");
export const PARTICIPATION_FEATURES = FEATURE_SWITCHES.filter((f) => f.group === "participation");

export function isFeatureKey(key: string): boolean {
  return FEATURE_SWITCHES.some((f) => f.key === key);
}
/** @deprecated name kept for existing callers; accepts any switch key. */
export const isCircleFeatureKey = isFeatureKey;

export async function featureOn(key: string): Promise<boolean> {
  if (!isFeatureKey(key)) throw new Error(`Unknown feature switch "${key}"`);
  return (await getSetting(key, "false")) === "true";
}
export const circleFeatureOn = featureOn;

async function statesFor(list: FeatureSwitch[]): Promise<Record<string, boolean>> {
  const entries = await Promise.all(list.map(async (f) => [f.key, await featureOn(f.key)] as const));
  return Object.fromEntries(entries);
}

/** { "circles.pulse": false, ... } — for GET /api/config and the admin card. */
export const circleFeatureStates = () => statesFor(CIRCLE_FEATURES);
export const experienceFeatureStates = () => statesFor(EXPERIENCE_FEATURES);
export const allFeatureStates = () => statesFor(FEATURE_SWITCHES);
export const participationFeatureStates = () => statesFor(PARTICIPATION_FEATURES);

export async function setFeature(key: string, enabled: boolean): Promise<void> {
  if (!isFeatureKey(key)) throw new Error(`Unknown feature switch "${key}"`);
  // A locked switch can always be turned off, never on from here.
  if (enabled && FEATURE_SWITCHES.find((f) => f.key === key)?.locked) throw new LockedFeatureError(`"${key}" needs the owner's approval before it can be switched on`);
  await setSetting(key, enabled ? "true" : "false");
}
export const setCircleFeature = setFeature;

/** Route guard: a switched-off feature looks like it doesn't exist. */
export function requireFeature(key: string) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    if (!(await featureOn(key))) return res.status(404).json({ error: "This isn't available yet" });
    next();
  };
}
export const requireCircleFeature = requireFeature;
