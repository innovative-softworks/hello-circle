import type { Request, Response } from "express";
import { db } from "./db/index.js";
import { featureOn } from "./circleFeatures.js";
import { commerceSwitch } from "./commerce/switches.js";

// Configuration framework Phase B (docs/participation-expansion/13, 14) — the
// organisation capability registry.
//
// Layers and precedence (never widened by anything here):
//   1. platform switch (FEATURE_SWITCHES / commerce switches) — off = off for all;
//   2. organisation capability (this file; state in the existing feature_flags
//      table, opt-out: a missing row means ON, so every existing organisation
//      keeps what it has today);
//   3. the existing role check (hasPlatformRole / requireAdminPermission);
//   4. ownership and scope (req.vendorIds, listing_staff_assignments).
// A capability never opens a commercial gate (PAID_CHECKOUT, VAT, refunds) and
// switching one off never deletes or hides existing listings, bookings or
// attendee data: it refuses new listings of that kind and the module's
// management actions (owner decision D-A3, recommended default).
//
// The three keys that existed before (programs, experiences, open_booking)
// keep their exact names and meaning.

export type CapabilityGroup = "listing" | "operations" | "commercial";
export type CapabilityStatus = "available" | "unavailable";
export type TemplateKey = "community_centre" | "sports_club" | "event_organiser" | "training_provider" | "experience_provider" | "community_association" | "custom";

export interface CapabilityLimit {
  key: string;
  label: string;
  /** Platform maximum; an organisation can be given a lower value, never higher. */
  max: number;
}

export interface Capability {
  key: string;
  label: string;
  description: string;
  group: CapabilityGroup;
  /** 'unavailable' = needs a platform decision first; can't be switched on for anyone. */
  status: CapabilityStatus;
  unavailableReason?: string;
  dependsOn: string[];
  /** Existing organisation roles that operate it (display; routes enforce their own groups). */
  operatedBy: string[];
  /** Platform switch that must also be on (a FEATURE_SWITCHES or commerce key). */
  platformSwitch?: { key: string; kind: "feature" | "commerce"; label: string };
  limits?: CapabilityLimit[];
  /** What switching it off does — shown to admins before they save. */
  whenOff: string;
}

const MANAGERS = ["owner", "centre_manager", "facility_manager"];

export const CAPABILITIES: Capability[] = [
  // --- listings ---
  { key: "venues", label: "Community centres and rooms", group: "listing", status: "available", dependsOn: [], operatedBy: ["owner", "centre_manager"], description: "List community centres with bookable rooms and take hall bookings.", whenOff: "No new centres. Existing centres, rooms and bookings carry on." },
  { key: "clubs", label: "Sports clubs", group: "listing", status: "available", dependsOn: [], operatedBy: ["owner", "facility_manager"], description: "List clubs with sessions and take member registrations.", whenOff: "No new clubs. Existing clubs and registrations carry on." },
  { key: "programs", label: "Programmes", group: "listing", status: "available", dependsOn: [], operatedBy: MANAGERS, description: "Multi-week courses with sessions, enrolment and attendance registers.", whenOff: "No new programmes. Existing programmes and enrolments carry on." },
  { key: "experiences", label: "Experiences and adventures", group: "listing", status: "available", dependsOn: [], operatedBy: MANAGERS, description: "Bookable experiences and adventures with dates and party bookings.", whenOff: "No new experiences, events or volunteering listings. Existing ones carry on." },
  { key: "events", label: "Community events", group: "listing", status: "available", dependsOn: ["experiences"], operatedBy: MANAGERS, platformSwitch: { key: "participation.events", kind: "feature", label: "Community events" }, description: "Cultural, faith and community events, found by search, filters and categories.", whenOff: "No new events. Existing events carry on." },
  { key: "volunteering", label: "Volunteering", group: "listing", status: "available", dependsOn: ["experiences"], operatedBy: MANAGERS, description: "Free volunteering listings with skills, cause and minimum age.", whenOff: "No new volunteering listings. Existing ones carry on." },
  // --- operations ---
  { key: "registration_options", label: "Registration options", group: "operations", status: "available", dependsOn: ["experiences"], operatedBy: MANAGERS, platformSwitch: { key: "participation.options", kind: "feature", label: "Registration options" }, description: "Several priced options on one listing (for example a family Pooja and single Darshan).", whenOff: "Options can't be changed. Listings that already sell options keep selling them." },
  { key: "attendees", label: "Attendee details", group: "operations", status: "available", dependsOn: [], operatedBy: [...MANAGERS], platformSwitch: { key: "participation.attendees", kind: "feature", label: "Attendee details and questions" }, description: "People say who is coming (adult or child, guardian); partners see the attendee list.", whenOff: "New bookings stop asking who is coming. Attendee details already given stay visible." },
  { key: "registration_questions", label: "Registration questions", group: "operations", status: "available", dependsOn: ["attendees"], operatedBy: MANAGERS, platformSwitch: { key: "participation.attendees", kind: "feature", label: "Attendee details and questions" }, limits: [{ key: "max_questions", label: "Most questions per listing", max: 12 }], description: "Partners ask their own questions when people book, within the platform's privacy rules.", whenOff: "Questions can't be changed and new bookings aren't asked them. Answers already given stay visible." },
  { key: "checkin", label: "Door check-in", group: "operations", status: "available", dependsOn: [], operatedBy: [...MANAGERS, "checkin_staff"], platformSwitch: { key: "participation.checkin", kind: "feature", label: "Door check-in" }, limits: [{ key: "max_staff", label: "Most check-in staff per listing", max: 50 }], description: "Check people in one by one at the door, and assign check-in-only staff.", whenOff: "The door screen and new check-in assignments stop. Check-ins already recorded stay." },
  { key: "open_booking", label: "Open Booking", group: "operations", status: "available", dependsOn: ["venues"], operatedBy: ["owner", "centre_manager"], platformSwitch: { key: "commerce.open_booking", kind: "commerce", label: "Open Booking (commerce)" }, description: "Residents propose a hall booking that others can join and share.", whenOff: "No new Open Bookings at this organisation's centres." },
  // --- commercial (decisions pending; never switched on from here) ---
  { key: "external_payments", label: "External payment verification", group: "commercial", status: "unavailable", unavailableReason: "Waits for the external-payments decision (PD-4).", dependsOn: [], operatedBy: ["owner", "finance"], description: "Record payments made outside HelloCircle; they stay pending until finance verifies them.", whenOff: "—" },
  { key: "donations", label: "Donations", group: "commercial", status: "unavailable", unavailableReason: "Needs an approved commercial, tax and receipt policy (PD-3, D-04).", dependsOn: [], operatedBy: ["owner", "finance"], description: "Accept donations with receipts.", whenOff: "—" },
];

export const CAPABILITY_KEYS = CAPABILITIES.map((c) => c.key);
export const isCapabilityKey = (k: string) => CAPABILITY_KEYS.includes(k);
const byKey = new Map(CAPABILITIES.map((c) => [c.key, c]));
export const capability = (key: string) => byKey.get(key);

// --- templates -------------------------------------------------------------------
// Defaults only: an organisation can combine anything its admin allows, and
// applying a template never deletes listings, bookings or attendee data.

export interface OrgTemplate {
  key: TemplateKey;
  label: string;
  description: string;
  capabilities: string[];
  /** Phase E — suggested categories (existing taxonomy ids). A preset only (D-A5): never an authorisation rule. */
  categories: string[];
}

export const TEMPLATES: OrgTemplate[] = [
  { key: "community_centre", label: "Community centre", description: "Halls and rooms, courses and community events.", capabilities: ["venues", "programs", "experiences", "events", "attendees", "registration_questions", "checkin", "open_booking"], categories: ["spaces-community", "spaces-sport", "spaces-creative", "learning", "fitness-wellness", "arts-crafts", "kids-family", "culture-faith-celebrations"] },
  { key: "sports_club", label: "Sports club", description: "Club membership, sessions and courses.", capabilities: ["clubs", "programs", "experiences", "events", "attendees", "registration_questions", "checkin"], categories: ["soccer", "gaelic-games", "racket-sports", "team-sports", "fitness-wellness", "water", "martial-arts", "dance"] },
  { key: "event_organiser", label: "Event organiser", description: "Community, cultural and faith events with options, attendees and door check-in.", capabilities: ["experiences", "events", "registration_options", "attendees", "registration_questions", "checkin"], categories: ["culture-faith-celebrations", "music", "food-drink", "arts-crafts", "culture-heritage", "kids-family"] },
  { key: "training_provider", label: "Training provider", description: "Courses and workshops.", capabilities: ["programs", "experiences", "attendees", "registration_questions", "checkin"], categories: ["learning", "technology", "arts-crafts", "fitness-wellness", "music"] },
  { key: "experience_provider", label: "Experience provider", description: "Experiences and adventures with dates and options.", capabilities: ["experiences", "registration_options", "attendees", "registration_questions", "checkin"], categories: ["outdoors", "water", "nature-wildlife", "day-trips", "food-drink", "culture-heritage"] },
  { key: "community_association", label: "Community association", description: "Events, volunteering and local programmes.", capabilities: ["experiences", "events", "volunteering", "programs", "attendees", "registration_questions", "checkin"], categories: ["culture-faith-celebrations", "volunteering", "kids-family", "meetups", "learning", "arts-crafts"] },
  { key: "custom", label: "Custom", description: "Choose each capability yourself.", capabilities: CAPABILITIES.filter((c) => c.status === "available").map((c) => c.key), categories: [] },
];
export const isTemplateKey = (k: unknown): k is TemplateKey => typeof k === "string" && TEMPLATES.some((t) => t.key === k);

// --- state -----------------------------------------------------------------------

export interface CapabilityState {
  key: string;
  /** The organisation's own setting (opt-out: no row = on). */
  orgEnabled: boolean;
  /** Platform switch on (or none needed). */
  platformOn: boolean;
  /** Every dependency is effective. */
  dependenciesOn: boolean;
  /** What the organisation can actually use. */
  effective: boolean;
  limits: Record<string, number>;
}

type Tx = Pick<typeof db, "prepare">;

async function platformOn(c: Capability): Promise<boolean> {
  if (!c.platformSwitch) return true;
  return c.platformSwitch.kind === "feature" ? featureOn(c.platformSwitch.key) : commerceSwitch(c.platformSwitch.key);
}

export async function orgSettings(orgId: string | null, tx: Tx = db): Promise<{ enabled: Map<string, boolean>; limits: Map<string, number> }> {
  const enabled = new Map<string, boolean>();
  const limits = new Map<string, number>();
  if (!orgId) return { enabled, limits };
  for (const r of (await tx.prepare(`SELECT flag_key, enabled FROM feature_flags WHERE org_id = ?`).all(orgId)) as { flag_key: string; enabled: number }[]) {
    enabled.set(r.flag_key, Number(r.enabled) === 1);
  }
  for (const r of (await tx.prepare(`SELECT limit_key, value FROM org_capability_limits WHERE org_id = ?`).all(orgId)) as { limit_key: string; value: number }[]) {
    limits.set(r.limit_key, Number(r.value));
  }
  return { enabled, limits };
}

/** Resolves every capability for an organisation (pure given its inputs). */
export function resolveStates(enabled: Map<string, boolean>, limits: Map<string, number>, platform: Map<string, boolean>): CapabilityState[] {
  const orgOn = (c: Capability) => c.status === "available" && (enabled.get(c.key) ?? true);
  const memo = new Map<string, boolean>();
  const effective = (key: string, seen = new Set<string>()): boolean => {
    if (memo.has(key)) return memo.get(key)!;
    const c = byKey.get(key);
    if (!c || seen.has(key)) return false;
    seen.add(key);
    const v = orgOn(c) && (platform.get(key) ?? true) && c.dependsOn.every((d) => effective(d, seen));
    memo.set(key, v);
    return v;
  };
  return CAPABILITIES.map((c) => ({
    key: c.key,
    orgEnabled: orgOn(c),
    platformOn: platform.get(c.key) ?? true,
    dependenciesOn: c.dependsOn.every((d) => effective(d)),
    effective: effective(c.key),
    limits: Object.fromEntries((c.limits ?? []).map((l) => [l.key, Math.min(l.max, limits.get(`${c.key}.${l.key}`) ?? l.max)])),
  }));
}

export async function platformStates(): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  for (const c of CAPABILITIES) out.set(c.key, await platformOn(c));
  return out;
}

export async function orgCapabilityStates(orgId: string | null): Promise<CapabilityState[]> {
  const { enabled, limits } = await orgSettings(orgId);
  return resolveStates(enabled, limits, await platformStates());
}

/** Effective state for the organisation a partner user belongs to. */
export async function capabilityFor(userId: string, key: string): Promise<CapabilityState | null> {
  const row = (await db.prepare(`SELECT org_id FROM users WHERE id = ?`).get(userId)) as { org_id: string | null } | undefined;
  return (await orgCapabilityStates(row?.org_id ?? null)).find((s) => s.key === key) ?? null;
}

export async function capabilityForOrg(orgId: string | null, key: string): Promise<CapabilityState | null> {
  return (await orgCapabilityStates(orgId)).find((s) => s.key === key) ?? null;
}

/** For the organisation that owns a listing (vendor_id → users.org_id). */
export async function capabilityForVendor(vendorId: string, key: string): Promise<CapabilityState | null> {
  return capabilityFor(vendorId, key);
}

export function capabilityOffMessage(key: string, s: CapabilityState | null): string {
  const c = byKey.get(key);
  const name = c?.label ?? key;
  if (!s || !s.orgEnabled) return `${name} isn't enabled for your organisation. Contact HelloCircle if you need it.`;
  if (!s.platformOn) return `${name} isn't available on HelloCircle yet.`;
  return `${name} needs ${c!.dependsOn.map((d) => byKey.get(d)?.label ?? d).join(" and ")} to be enabled first.`;
}

/**
 * Route guard for partner routes: sends 403 { capabilityOff } and returns
 * false when the caller's organisation can't use `key`. Mount after
 * requireVendor. `ownerVendorId` = the listing owner when acting on a listing.
 */
export async function assertCapability(req: Request, res: Response, key: string, ownerVendorId?: string): Promise<boolean> {
  const s = await capabilityFor(ownerVendorId ?? req.user!.id, key);
  if (s?.effective) return true;
  res.status(403).json({ error: capabilityOffMessage(key, s), capabilityOff: key });
  return false;
}

/** The current limit for an organisation (platform maximum when unset). */
export async function capabilityLimit(vendorId: string, key: string, limitKey: string): Promise<number> {
  const s = await capabilityFor(vendorId, key);
  const c = byKey.get(key);
  const fallback = c?.limits?.find((l) => l.key === limitKey)?.max ?? Number.MAX_SAFE_INTEGER;
  return s?.limits[limitKey] ?? fallback;
}

// --- validation for admin changes --------------------------------------------------

export class CapabilityChangeError extends Error {
  constructor(message: string, readonly status = 400, readonly details?: unknown) {
    super(message);
  }
}

export interface CapabilityChange {
  enabled: Record<string, boolean>;
  limits: Record<string, number>;
}

/** Validates a change against the registry and dependencies; returns the final org settings. */
export function planChange(current: { enabled: Map<string, boolean>; limits: Map<string, number> }, raw: unknown): { enabled: Map<string, boolean>; limits: Map<string, number>; change: CapabilityChange } {
  const body = (raw ?? {}) as { enabled?: unknown; limits?: unknown };
  const enabledIn = body.enabled && typeof body.enabled === "object" ? (body.enabled as Record<string, unknown>) : {};
  const limitsIn = body.limits && typeof body.limits === "object" ? (body.limits as Record<string, unknown>) : {};
  const enabled = new Map(current.enabled);
  const limits = new Map(current.limits);
  const change: CapabilityChange = { enabled: {}, limits: {} };
  for (const [key, v] of Object.entries(enabledIn)) {
    const c = byKey.get(key);
    if (!c) throw new CapabilityChangeError(`Unknown capability "${key}"`);
    if (typeof v !== "boolean") throw new CapabilityChangeError(`${c.label}: say on or off`);
    if (v && c.status !== "available") throw new CapabilityChangeError(`${c.label} can't be switched on: ${c.unavailableReason ?? "not available yet"}`, 409);
    // Only real changes are recorded (a template re-states every capability).
    if ((current.enabled.get(key) ?? true) !== v) change.enabled[key] = v;
    enabled.set(key, v);
  }
  for (const [path, v] of Object.entries(limitsIn)) {
    const [key, limitKey] = path.split(".");
    const def = byKey.get(key)?.limits?.find((l) => l.key === limitKey);
    if (!def) throw new CapabilityChangeError(`Unknown limit "${path}"`);
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > def.max) throw new CapabilityChangeError(`${def.label}: a whole number from 1 to ${def.max}`);
    if (current.limits.get(path) !== v) change.limits[path] = v;
    limits.set(path, v);
  }
  const on = (k: string) => byKey.get(k)!.status === "available" && (enabled.get(k) ?? true);
  const broken = CAPABILITIES.filter((c) => on(c.key) && c.dependsOn.some((d) => !on(d)));
  if (broken.length) {
    throw new CapabilityChangeError(
      broken.map((c) => `${c.label} needs ${c.dependsOn.filter((d) => !on(d)).map((d) => byKey.get(d)!.label).join(" and ")}`).join("; "),
      409,
      { needs: broken.map((c) => ({ key: c.key, missing: c.dependsOn.filter((d) => !on(d)) })) }
    );
  }
  return { enabled, limits, change };
}

/** The template's capability set as a change (everything else off). */
export function templateChange(template: TemplateKey): Record<string, boolean> {
  const t = TEMPLATES.find((x) => x.key === template)!;
  return Object.fromEntries(CAPABILITIES.filter((c) => c.status === "available").map((c) => [c.key, t.capabilities.includes(c.key)]));
}

/** What already exists under each capability (informational, before switching off). */
export async function capabilityUsage(orgId: string): Promise<Record<string, number>> {
  const members = (await db.prepare(`SELECT id FROM users WHERE org_id = ?`).all(orgId)) as { id: string }[];
  const ids = members.map((m) => m.id);
  if (!ids.length) return {};
  const ph = ids.map(() => "?").join(", ");
  const n = async (sql: string) => Number(((await db.prepare(sql).get(...ids)) as { n: number }).n);
  return {
    venues: await n(`SELECT COUNT(*) AS n FROM centres WHERE vendor_id IN (${ph}) AND status != 'deleted'`),
    clubs: await n(`SELECT COUNT(*) AS n FROM clubs WHERE vendor_id IN (${ph}) AND status != 'deleted'`),
    programs: await n(`SELECT COUNT(*) AS n FROM programs WHERE vendor_id IN (${ph})`),
    experiences: await n(`SELECT COUNT(*) AS n FROM experiences WHERE vendor_id IN (${ph}) AND status != 'deleted'`),
    events: await n(`SELECT COUNT(*) AS n FROM experiences WHERE vendor_id IN (${ph}) AND kind = 'event' AND status != 'deleted'`),
    volunteering: await n(`SELECT COUNT(*) AS n FROM experiences WHERE vendor_id IN (${ph}) AND kind = 'volunteer' AND status != 'deleted'`),
    registration_options: await n(`SELECT COUNT(DISTINCT o.listing_id) AS n FROM offering_options o JOIN experiences e ON e.id = o.listing_id WHERE e.vendor_id IN (${ph}) AND o.active = 1`),
    registration_questions: await n(`SELECT COUNT(DISTINCT q.listing_id) AS n FROM registration_questions q JOIN experiences e ON e.id = q.listing_id WHERE e.vendor_id IN (${ph}) AND q.active = 1`),
    checkin: await n(`SELECT COUNT(*) AS n FROM listing_staff_assignments a JOIN experiences e ON e.id = a.listing_id WHERE e.vendor_id IN (${ph}) AND a.revoked_at IS NULL`),
  };
}
