import { db } from "../db/index.js";
import { occupiesCapacitySql } from "../bookingIntegrity.js";
import { PLATFORM_FEE_RATE, VAT_RATE } from "../pricing.js";
import { activeOptions, MAX_HEADS_PER_ORDER, MAX_UNITS_PER_LINE, onSale, type OfferingOption } from "./options.js";

// Participation Expansion Phase 1 — the ONE place an order's lines are priced
// (docs/participation-expansion/05 §1). The client sends only
// [{ optionId, quantity }]; every unit price, head count and limit is read
// from offering_options here. The sum of the lines is then handed to the
// existing pricing (legacy computePricing or the commerce engine) as the
// order's list price, so VAT, fee, coupons and the checkout agreement work
// exactly as for a single-price order.

type Tx = Pick<typeof db, "prepare">;

export interface RequestedLine {
  optionId: string;
  quantity: number;
}

export interface ResolvedLine {
  lineNo: number;
  option: OfferingOption;
  quantity: number;
  heads: number;
  unitMinor: number;
  totalMinor: number;
}

export interface ResolvedLines {
  lines: ResolvedLine[];
  listMinor: number;
  heads: number;
  /** Canonical form of what was asked for — stored on a quote and compared at checkout. */
  key: string;
}

export class LineError extends Error {
  constructor(message: string, readonly code: "invalid" | "unavailable" | "sold_out" | "limit") {
    super(message);
  }
}

/** Parses the request body's `lines` (shape only; prices come later). */
export function parseRequestedLines(raw: unknown): RequestedLine[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new LineError("Choose at least one option", "invalid");
  if (raw.length > 20) throw new LineError("Too many options in one booking", "invalid");
  const seen = new Set<string>();
  return raw.map((r) => {
    const o = (r ?? {}) as { optionId?: unknown; quantity?: unknown };
    if (typeof o.optionId !== "string" || !o.optionId) throw new LineError("Choose an option", "invalid");
    if (seen.has(o.optionId)) throw new LineError("Each option can only be listed once", "invalid");
    seen.add(o.optionId);
    if (typeof o.quantity !== "number" || !Number.isInteger(o.quantity) || o.quantity < 1 || o.quantity > MAX_UNITS_PER_LINE) {
      throw new LineError(`Quantity must be a whole number between 1 and ${MAX_UNITS_PER_LINE}`, "invalid");
    }
    return { optionId: o.optionId, quantity: o.quantity };
  });
}

export function linesKey(requested: RequestedLine[]): string {
  return JSON.stringify([...requested].sort((a, b) => a.optionId.localeCompare(b.optionId)).map((r) => [r.optionId, r.quantity]));
}

/** Prices requested lines against the listing's live options. Throws LineError. */
export async function resolveLines(listingId: string, requested: RequestedLine[], now: Date = new Date(), tx: Tx = db): Promise<ResolvedLines> {
  const options = new Map((await activeOptions("experience", listingId, tx)).map((o) => [o.id, o]));
  const lines: ResolvedLine[] = [];
  let heads = 0;
  // Options first (display order), then add-ons, so add-on limits can use the head count.
  const ordered = [...requested].sort((a, b) => {
    const oa = options.get(a.optionId), ob = options.get(b.optionId);
    const ka = oa?.kind === "addon" ? 1 : 0, kb = ob?.kind === "addon" ? 1 : 0;
    return ka - kb || (oa?.sortOrder ?? 0) - (ob?.sortOrder ?? 0);
  });
  for (const r of ordered) {
    const option = options.get(r.optionId);
    if (!option) throw new LineError("One of the options you chose is no longer available", "unavailable");
    if (!onSale(option, now)) throw new LineError(`${option.label} isn't on sale right now`, "unavailable");
    if (option.maxPerOrder !== null && r.quantity > option.maxPerOrder) throw new LineError(`${option.label}: at most ${option.maxPerOrder} per booking`, "limit");
    if (option.kind !== "addon") heads += r.quantity * option.headsPerUnit;
  }
  if (!ordered.some((r) => options.get(r.optionId)!.kind !== "addon")) throw new LineError("Choose at least one option that includes people, not only add-ons", "invalid");
  if (heads < 1) throw new LineError("A booking needs at least one person", "invalid");
  if (heads > MAX_HEADS_PER_ORDER) throw new LineError(`A booking can include at most ${MAX_HEADS_PER_ORDER} people`, "limit");
  let lineNo = 0;
  for (const r of ordered) {
    const option = options.get(r.optionId)!;
    if (option.kind === "addon" && option.priceBasis === "per_person" && r.quantity > heads) {
      throw new LineError(`${option.label}: at most one per person (${heads})`, "limit");
    }
    lineNo += 1;
    const lineHeads = option.kind === "addon" ? 0 : r.quantity * option.headsPerUnit;
    lines.push({ lineNo, option, quantity: r.quantity, heads: lineHeads, unitMinor: option.priceMinor, totalMinor: option.priceMinor * r.quantity });
  }
  const listMinor = lines.reduce((s, l) => s + l.totalMinor, 0);
  if (!Number.isSafeInteger(listMinor)) throw new LineError("That booking total isn't valid", "invalid");
  return { lines, listMinor, heads, key: linesKey(requested) };
}

/** How much of an option's own limit is taken on a departure: heads for
 * options, units for add-ons. Counts every order currently holding a place. */
export async function optionTaken(tx: Tx, optionId: string, sessionId: string, excludeRef: string | null = null): Promise<number> {
  const r = (await tx
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN ol.line_kind = 'addon' THEN ol.quantity ELSE ol.heads END), 0) AS n
       FROM order_lines ol JOIN experience_bookings eb ON ol.source_type = 'experience' AND eb.ref = ol.source_ref
       WHERE ol.option_id = ? AND eb.session_id = ? AND eb.pricing_mode = 'lines' AND ${occupiesCapacitySql("eb")}${excludeRef ? " AND eb.ref != ?" : ""}`
    )
    .get(...(excludeRef ? [optionId, sessionId, excludeRef] : [optionId, sessionId]))) as { n: number | string };
  return Number(r.n);
}

/**
 * Per-option limits, checked inside the checkout transaction AFTER the
 * session row lock (lock order: session, then options by id). Throws
 * LineError('sold_out') naming the option.
 */
export async function assertOptionCapacity(tx: Tx, sessionId: string, resolved: ResolvedLines, excludeRef: string | null = null): Promise<void> {
  const limited = resolved.lines.filter((l) => l.option.capacity !== null).sort((a, b) => a.option.id.localeCompare(b.option.id));
  for (const l of limited) {
    await tx.prepare(`SELECT id FROM offering_options WHERE id = ? FOR UPDATE`).get(l.option.id);
    const taken = await optionTaken(tx, l.option.id, sessionId, excludeRef);
    const wants = l.option.kind === "addon" ? l.quantity : l.heads;
    if (taken + wants > l.option.capacity!) {
      const left = Math.max(0, l.option.capacity! - taken);
      throw new LineError(left === 0 ? `${l.option.label} is sold out for this date` : `Only ${left} left for ${l.option.label} on this date`, "sold_out");
    }
  }
}

/** Places left per option on one departure, for display (no lock). */
export async function optionsLeft(options: OfferingOption[], sessionId: string): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const o of options) out[o.id] = o.capacity === null ? null : Math.max(0, o.capacity - (await optionTaken(db, o.id, sessionId)));
  return out;
}

// --- purchase snapshots -------------------------------------------------------

export interface PricingSnapshot {
  vatBps: number;
  vatMode: string;
  feeBps: number;
  /** "legacy:pricing.ts" or "engine:<rule hash>". */
  source: string;
}

/** What legacy pricing (pricing.ts) applies today, as basis points. */
export function legacySnapshot(): PricingSnapshot {
  return { vatBps: Math.round(VAT_RATE * 10_000), vatMode: "added_on_top", feeBps: Math.round(PLATFORM_FEE_RATE * 10_000), source: "legacy:pricing.ts" };
}

/** Writes the purchased lines inside the checkout transaction. A deleted
 * (abandoned) pending row frees its ref for reuse, so clear first. */
export async function writeOrderLines(tx: Tx, sourceType: "experience", ref: string, resolved: ResolvedLines, snap: PricingSnapshot): Promise<void> {
  await tx.prepare(`DELETE FROM order_lines WHERE source_type = ? AND source_ref = ?`).run(sourceType, ref);
  for (const l of resolved.lines) {
    await tx
      .prepare(
        `INSERT INTO order_lines (source_type, source_ref, line_no, line_kind, option_id, label_snapshot, description_snapshot, price_basis_snapshot, age_band_snapshot,
           heads_per_unit_snapshot, unit_minor, quantity_purchased, heads_purchased, quantity, heads, tax_treatment_snapshot, vat_bps_snapshot, vat_mode_snapshot,
           fee_bps_snapshot, pricing_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'standard', ?, ?, ?, ?)`
      )
      .run(
        sourceType, ref, l.lineNo, l.option.kind === "addon" ? "addon" : "option", l.option.id, l.option.label, l.option.description, l.option.priceBasis,
        l.option.ageBand, l.option.headsPerUnit, l.unitMinor, l.quantity, l.heads, l.quantity, l.heads, snap.vatBps, snap.vatMode, snap.feeBps, snap.source.slice(0, 90)
      );
  }
}

export interface OrderLineView {
  lineNo: number;
  kind: "option" | "addon";
  label: string;
  description: string;
  priceBasis: string;
  ageBand: string | null;
  unitMinor: number;
  quantity: number;
  quantityPurchased: number;
  heads: number;
  totalMinor: number;
  refundedQuantity: number;
  refundedMinor: number;
}

/** The purchased lines of one order, for My Life, receipts and partners.
 * Never switch-gated: an order bought with options stays readable. */
export async function readOrderLines(sourceType: "experience", ref: string, tx: Tx = db): Promise<OrderLineView[]> {
  const rows = (await tx
    .prepare(`SELECT * FROM order_lines WHERE source_type = ? AND source_ref = ? ORDER BY line_no`)
    .all(sourceType, ref)) as Record<string, any>[];
  return rows.map((r) => ({
    lineNo: Number(r.line_no),
    kind: r.line_kind === "addon" ? "addon" : "option",
    label: r.label_snapshot,
    description: r.description_snapshot,
    priceBasis: r.price_basis_snapshot,
    ageBand: r.age_band_snapshot ?? null,
    unitMinor: Number(r.unit_minor),
    quantity: Number(r.quantity),
    quantityPurchased: Number(r.quantity_purchased),
    heads: Number(r.heads),
    totalMinor: Number(r.unit_minor) * Number(r.quantity_purchased),
    refundedQuantity: Number(r.refunded_quantity),
    refundedMinor: Number(r.refunded_minor),
  }));
}

/** Lines for many orders at once (lists). */
export async function readOrderLinesFor(sourceType: "experience", refs: string[]): Promise<Map<string, OrderLineView[]>> {
  const out = new Map<string, OrderLineView[]>();
  if (!refs.length) return out;
  const rows = (await db
    .prepare(`SELECT source_ref FROM order_lines WHERE source_type = ? AND source_ref IN (${refs.map(() => "?").join(", ")}) GROUP BY source_ref`)
    .all(sourceType, ...refs)) as { source_ref: string }[];
  for (const r of rows) out.set(r.source_ref, await readOrderLines(sourceType, r.source_ref));
  return out;
}

/** One-line summary for cards and notifications: "Pooja × 1 · Darshan × 2". */
export function linesSummary(lines: Pick<OrderLineView, "label" | "quantity">[]): string {
  return lines.filter((l) => l.quantity > 0).map((l) => `${l.label} × ${l.quantity}`).join(" · ");
}
