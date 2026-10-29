import crypto from "node:crypto";
import { db } from "../db/index.js";
import { featureOn } from "../circleFeatures.js";

// Participation Expansion Phase 1 — registration options on a listing
// (docs/participation-expansion/03 §3.1, 07 §3.2). Phase 1 sells options on
// experiences only (adventure / experience / volunteer / event).
//
// Rules worth knowing:
// - A listing with no active options sells exactly as before (one price ×
//   party size). With options, the price comes only from these rows, never
//   from the client.
// - One VAT treatment per order in Phase 1: every option is 'standard'
//   (the order's own pricing rule); anything else is refused.
// - Saving replaces the set under an optimistic version (409 when stale).
//   Options are never deleted, only deactivated, so purchased lines always
//   point at a real row; purchased lines carry their own snapshot anyway.

type Tx = Pick<typeof db, "prepare">;

export const OPTION_KINDS = ["option", "addon", "bundle"] as const;
export const PRICE_BASES = ["per_person", "per_booking"] as const;
export const AGE_BANDS = ["adult", "child", "infant", "senior", "any"] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];
export type PriceBasis = (typeof PRICE_BASES)[number];
export type AgeBand = (typeof AGE_BANDS)[number];

export const MAX_OPTIONS = 20;
export const MAX_PRICE_MINOR = 1_000_000; // €10,000 — a typo guard, not a commercial limit
export const MAX_HEADS_PER_UNIT = 50;
export const MAX_UNITS_PER_LINE = 50;
export const MAX_HEADS_PER_ORDER = 200;

export interface OfferingOption {
  id: string;
  kind: OptionKind;
  label: string;
  description: string;
  priceMinor: number;
  priceBasis: PriceBasis;
  headsPerUnit: number;
  ageBand: AgeBand | null;
  capacity: number | null;
  maxPerOrder: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  taxTreatment: "standard";
  sortOrder: number;
  active: boolean;
}

interface OptionRow {
  id: string;
  kind: string;
  label: string;
  description: string;
  price_minor: number;
  price_basis: string;
  heads_per_unit: number;
  age_band: string | null;
  capacity: number | null;
  max_per_order: number | null;
  sale_starts_at: Date | string | null;
  sale_ends_at: Date | string | null;
  tax_treatment: string;
  sort_order: number;
  active: number;
}

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

function toOption(r: OptionRow): OfferingOption {
  return {
    id: r.id,
    kind: r.kind as OptionKind,
    label: r.label,
    description: r.description,
    priceMinor: Number(r.price_minor),
    priceBasis: r.price_basis as PriceBasis,
    headsPerUnit: Number(r.heads_per_unit),
    ageBand: (r.age_band as AgeBand | null) ?? null,
    capacity: r.capacity === null ? null : Number(r.capacity),
    maxPerOrder: r.max_per_order === null ? null : Number(r.max_per_order),
    saleStartsAt: iso(r.sale_starts_at),
    saleEndsAt: iso(r.sale_ends_at),
    taxTreatment: "standard",
    sortOrder: Number(r.sort_order),
    active: Number(r.active) === 1,
  };
}

/** Every option of a listing (active and inactive), in display order. */
export async function listOptions(listingType: "experience", listingId: string, tx: Tx = db): Promise<OfferingOption[]> {
  const rows = (await tx
    .prepare(`SELECT * FROM offering_options WHERE listing_type = ? AND listing_id = ? ORDER BY sort_order, created_at, id`)
    .all(listingType, listingId)) as OptionRow[];
  return rows.map(toOption);
}

export async function activeOptions(listingType: "experience", listingId: string, tx: Tx = db): Promise<OfferingOption[]> {
  return (await listOptions(listingType, listingId, tx)).filter((o) => o.active);
}

/** True when the listing sells through options (at least one active one). */
export async function listingUsesOptions(listingType: "experience", listingId: string, tx: Tx = db): Promise<boolean> {
  const r = (await tx.prepare(`SELECT 1 AS ok FROM offering_options WHERE listing_type = ? AND listing_id = ? AND active = 1 LIMIT 1`).get(listingType, listingId)) as { ok: number } | undefined;
  return !!r;
}

/** Is an option on sale at `now` (its own sale window)? */
export function onSale(o: Pick<OfferingOption, "saleStartsAt" | "saleEndsAt">, now: Date = new Date()): boolean {
  if (o.saleStartsAt && new Date(o.saleStartsAt).getTime() > now.getTime()) return false;
  if (o.saleEndsAt && new Date(o.saleEndsAt).getTime() <= now.getTime()) return false;
  return true;
}

export const participationOptionsOn = () => featureOn("participation.options");
export const participationEventsOn = () => featureOn("participation.events");
export const partialCancelOn = () => featureOn("participation.partial_cancel");
export const attendeesOn = () => featureOn("participation.attendees");
export const checkinOn = () => featureOn("participation.checkin");
export const specialCategoryQuestionsOn = () => featureOn("participation.special_category_questions");

// --- validation ---------------------------------------------------------------

export interface OptionInput {
  id?: unknown;
  kind?: unknown;
  label?: unknown;
  description?: unknown;
  priceMinor?: unknown;
  priceBasis?: unknown;
  headsPerUnit?: unknown;
  ageBand?: unknown;
  capacity?: unknown;
  maxPerOrder?: unknown;
  saleStartsAt?: unknown;
  saleEndsAt?: unknown;
  taxTreatment?: unknown;
  active?: unknown;
}

export interface CleanOption {
  id: string | null;
  kind: OptionKind;
  label: string;
  description: string;
  priceMinor: number;
  priceBasis: PriceBasis;
  headsPerUnit: number;
  ageBand: AgeBand | null;
  capacity: number | null;
  maxPerOrder: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  active: boolean;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const optionalInt = (v: unknown) => v === undefined || v === null || v === "";

function parseDate(v: unknown): Date | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

export class OptionValidationError extends Error {
  constructor(message: string, readonly index: number | null = null, readonly field: string | null = null) {
    super(message);
  }
}

/** Validates a full option set as a partner sends it. `free` = the listing
 * can't charge (volunteering), so every price must be 0. */
export function cleanOptionSet(raw: unknown, opts: { free: boolean }): CleanOption[] {
  if (!Array.isArray(raw)) throw new OptionValidationError("Send the options as a list");
  if (raw.length > MAX_OPTIONS) throw new OptionValidationError(`A listing can have at most ${MAX_OPTIONS} options`);
  const out: CleanOption[] = [];
  const seenIds = new Set<string>();
  raw.forEach((item, i) => {
    const o = (item ?? {}) as OptionInput;
    const n = `Option ${i + 1}`;
    const kind = (o.kind ?? "option") as OptionKind;
    if (!(OPTION_KINDS as readonly string[]).includes(kind)) throw new OptionValidationError(`${n}: choose option, add-on or bundle`, i, "kind");
    const label = typeof o.label === "string" ? o.label.trim().replace(/\s+/g, " ") : "";
    if (!label) throw new OptionValidationError(`${n}: give it a name`, i, "label");
    if (label.length > 120) throw new OptionValidationError(`${n}: keep the name under 120 characters`, i, "label");
    const description = typeof o.description === "string" ? o.description.trim() : "";
    if (description.length > 500) throw new OptionValidationError(`${n}: keep what's included under 500 characters`, i, "description");
    if (!isInt(o.priceMinor) || o.priceMinor < 0 || o.priceMinor > MAX_PRICE_MINOR) throw new OptionValidationError(`${n}: price must be zero or more, in whole cents`, i, "priceMinor");
    const priceMinor = o.priceMinor;
    if (opts.free && priceMinor !== 0) throw new OptionValidationError(`${n}: volunteering is always free`, i, "priceMinor");
    const priceBasis = (o.priceBasis ?? "per_person") as PriceBasis;
    if (!(PRICE_BASES as readonly string[]).includes(priceBasis)) throw new OptionValidationError(`${n}: choose per person or per booking`, i, "priceBasis");
    let headsPerUnit = o.headsPerUnit === undefined ? (kind === "addon" ? 0 : 1) : o.headsPerUnit;
    if (!isInt(headsPerUnit)) throw new OptionValidationError(`${n}: people per unit must be a whole number`, i, "headsPerUnit");
    if (kind === "addon") {
      if (headsPerUnit !== 0) throw new OptionValidationError(`${n}: an add-on doesn't add people`, i, "headsPerUnit");
    } else if (headsPerUnit < 1 || headsPerUnit > MAX_HEADS_PER_UNIT) {
      throw new OptionValidationError(`${n}: people per unit must be between 1 and ${MAX_HEADS_PER_UNIT}`, i, "headsPerUnit");
    }
    if (kind === "option" && priceBasis === "per_person") headsPerUnit = 1;
    if (kind === "bundle" && priceBasis !== "per_booking") throw new OptionValidationError(`${n}: a bundle is priced per booking`, i, "priceBasis");
    const ageBand = o.ageBand === undefined || o.ageBand === null || o.ageBand === "" ? null : (o.ageBand as AgeBand);
    if (ageBand !== null && !(AGE_BANDS as readonly string[]).includes(ageBand)) throw new OptionValidationError(`${n}: unknown age group`, i, "ageBand");
    const capacity = optionalInt(o.capacity) ? null : o.capacity;
    if (capacity !== null && (!isInt(capacity) || capacity < 1)) throw new OptionValidationError(`${n}: the limit must be at least 1`, i, "capacity");
    const maxPerOrder = optionalInt(o.maxPerOrder) ? null : o.maxPerOrder;
    if (maxPerOrder !== null && (!isInt(maxPerOrder) || maxPerOrder < 1 || maxPerOrder > MAX_UNITS_PER_LINE)) throw new OptionValidationError(`${n}: the most per booking must be between 1 and ${MAX_UNITS_PER_LINE}`, i, "maxPerOrder");
    const saleStartsAt = parseDate(o.saleStartsAt);
    const saleEndsAt = parseDate(o.saleEndsAt);
    if (saleStartsAt === "invalid" || saleEndsAt === "invalid") throw new OptionValidationError(`${n}: check the sale dates`, i, "saleEndsAt");
    if (saleStartsAt && saleEndsAt && saleStartsAt >= saleEndsAt) throw new OptionValidationError(`${n}: the sale has to start before it ends`, i, "saleEndsAt");
    // Phase 1: one VAT treatment per order — every option uses the order's rule.
    if (o.taxTreatment !== undefined && o.taxTreatment !== null && o.taxTreatment !== "standard") {
      throw new OptionValidationError(`${n}: a different VAT treatment per option isn't supported yet`, i, "taxTreatment");
    }
    const id = typeof o.id === "string" && o.id ? o.id : null;
    if (id) {
      if (seenIds.has(id)) throw new OptionValidationError(`${n}: duplicated option`, i, "id");
      seenIds.add(id);
    }
    out.push({ id, kind, label, description, priceMinor, priceBasis, headsPerUnit: headsPerUnit as number, ageBand, capacity: capacity as number | null, maxPerOrder: maxPerOrder as number | null, saleStartsAt, saleEndsAt, active: o.active === undefined ? true : o.active === true });
  });
  const live = out.filter((o) => o.active);
  if (live.length > 0 && !live.some((o) => o.kind !== "addon")) throw new OptionValidationError("Add at least one option people can book (not only add-ons)");
  return out;
}

export class OptionsVersionError extends Error {}

/**
 * Replaces a listing's option set inside the caller's transaction. Existing
 * ids are updated, new ones inserted, missing ones deactivated (never
 * deleted). Bumps experiences.options_version; refuses a stale version. Then
 * rolls the cheapest live option up into experiences.price_cents, so every
 * card and sort that reads the one "from" price keeps working.
 */
export async function replaceExperienceOptions(
  tx: Tx,
  experienceId: string,
  options: CleanOption[],
  expectedVersion: number,
  actorUserId: string
): Promise<{ version: number }> {
  const row = (await tx.prepare(`SELECT options_version FROM experiences WHERE id = ? FOR UPDATE`).get(experienceId)) as { options_version: number } | undefined;
  if (!row) throw new OptionValidationError("Listing not found");
  if (Number(row.options_version) !== expectedVersion) throw new OptionsVersionError("These options changed since you opened them — reload to see the latest");
  const existing = (await tx.prepare(`SELECT id FROM offering_options WHERE listing_type = 'experience' AND listing_id = ?`).all(experienceId)) as { id: string }[];
  const existingIds = new Set(existing.map((r) => r.id));
  const kept = new Set<string>();
  for (const [i, o] of options.entries()) {
    if (o.id && !existingIds.has(o.id)) throw new OptionValidationError(`Option ${i + 1} doesn't belong to this listing`, i, "id");
    const values = [o.kind, o.label, o.description, o.priceMinor, o.priceBasis, o.headsPerUnit, o.ageBand, o.capacity, o.maxPerOrder, o.saleStartsAt, o.saleEndsAt, (i + 1) * 10, o.active ? 1 : 0];
    if (o.id) {
      kept.add(o.id);
      await tx
        .prepare(
          `UPDATE offering_options SET kind = ?, label = ?, description = ?, price_minor = ?, price_basis = ?, heads_per_unit = ?, age_band = ?, capacity = ?,
             max_per_order = ?, sale_starts_at = ?, sale_ends_at = ?, sort_order = ?, active = ?, tax_treatment = 'standard'
           WHERE id = ? AND listing_type = 'experience' AND listing_id = ?`
        )
        .run(...values, o.id, experienceId);
    } else {
      await tx
        .prepare(
          `INSERT INTO offering_options (id, listing_type, listing_id, kind, label, description, price_minor, price_basis, heads_per_unit, age_band, capacity,
             max_per_order, sale_starts_at, sale_ends_at, sort_order, active, tax_treatment, created_by_user_id)
           VALUES (?, 'experience', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'standard', ?)`
        )
        .run(crypto.randomUUID(), experienceId, ...values, actorUserId);
    }
  }
  for (const id of existingIds) if (!kept.has(id)) await tx.prepare(`UPDATE offering_options SET active = 0 WHERE id = ?`).run(id);
  const version = Number(row.options_version) + 1;
  await tx.prepare(`UPDATE experiences SET options_version = ? WHERE id = ?`).run(version, experienceId);
  const cheapest = (await tx
    .prepare(`SELECT MIN(price_minor) AS m FROM offering_options WHERE listing_type = 'experience' AND listing_id = ? AND active = 1 AND kind != 'addon'`)
    .get(experienceId)) as { m: number | null };
  if (cheapest.m !== null) await tx.prepare(`UPDATE experiences SET price_cents = ? WHERE id = ?`).run(Number(cheapest.m), experienceId);
  return { version };
}
