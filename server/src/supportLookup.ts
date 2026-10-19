import { db } from "./db/index.js";

// Support console lookups (admin Support page, 2026-10-16). One read-only
// view over the six order tables (the "five participation tables" plus
// passes stay separate in the schema; see CLAUDE.md), normalised to a single
// row shape so support staff can find a customer by reference, email or name
// without knowing which table their order lives in. Nothing here writes.

export type OrderKind = "booking" | "registration" | "program" | "game" | "experience" | "pass";
export const ORDER_KINDS: OrderKind[] = ["booking", "registration", "program", "game", "experience", "pass"];

export interface SupportOrder {
  kind: OrderKind;
  ref: string;
  name: string | null;
  email: string | null;
  listingName: string | null;
  /** Session date/time as stored (Ireland wall clock), when the order has one. */
  whenText: string | null;
  amountCents: number | null;
  paymentStatus: string | null;
  status: string | null;
  createdAt: string;
  residentId: string | null;
}

interface Source {
  kind: OrderKind;
  /** SELECT list producing the SupportOrder columns. */
  select: string;
  from: string;
  /** Column expressions for matching. */
  ref: string;
  email: string;
  name: string;
  listing: string;
  resident: string;
  created: string;
  /** Extra detail columns for the order page. */
  extra: string;
}

// game_participants rows made before refs existed have no ref; they are
// addressed as "#<id>".
const SOURCES: Source[] = [
  {
    kind: "booking",
    select: `b.ref AS ref, b.name AS name, b.email AS email, c.name AS listingName, CONCAT(b.date, ' ', b.time) AS whenText, b.total_cents AS amountCents, b.payment_status AS paymentStatus, b.status AS status, b.created_at AS createdAt, b.resident_id AS residentId`,
    from: `bookings b LEFT JOIN centres c ON c.id = b.centre_id`,
    ref: "b.ref",
    email: "b.email",
    name: "b.name",
    listing: "c.name",
    resident: "b.resident_id",
    created: "b.created_at",
    extra: `b.phone AS phone, b.guests AS guests, b.duration AS durationHours, b.event_type AS eventType, (SELECT r.name FROM rooms r WHERE r.centre_id = b.centre_id AND r.id = b.room_id) AS roomName, b.notes AS notes`,
  },
  {
    kind: "registration",
    select: `r.ref AS ref, TRIM(CONCAT(r.g_first, ' ', r.g_last)) AS name, r.email AS email, cl.name AS listingName, NULL AS whenText, r.total_cents AS amountCents, r.payment_status AS paymentStatus, r.status AS status, r.created_at AS createdAt, r.resident_id AS residentId`,
    from: `registrations r LEFT JOIN clubs cl ON cl.id = r.club_id`,
    ref: "r.ref",
    email: "r.email",
    name: "CONCAT(r.g_first, ' ', r.g_last, ' ', r.child_first, ' ', r.child_last)",
    listing: "cl.name",
    resident: "r.resident_id",
    created: "r.created_at",
    extra: `r.phone AS phone, TRIM(CONCAT(r.child_first, ' ', r.child_last)) AS participant, r.team AS team, r.trial AS trial`,
  },
  {
    kind: "program",
    select: `pe.ref AS ref, pe.participant_name AS name, pe.email AS email, p.title AS listingName, NULL AS whenText, pe.total_cents AS amountCents, pe.payment_status AS paymentStatus, pe.status AS status, pe.created_at AS createdAt, pe.resident_id AS residentId`,
    from: `program_enrollments pe LEFT JOIN programs p ON p.id = pe.program_id`,
    ref: "pe.ref",
    email: "pe.email",
    name: "pe.participant_name",
    listing: "p.title",
    resident: "pe.resident_id",
    created: "pe.created_at",
    extra: `pe.phone AS phone, pe.participant_name AS participant`,
  },
  {
    kind: "game",
    select: `COALESCE(gp.ref, CONCAT('#', gp.id)) AS ref, res.name AS name, res.email AS email, g.activity_label AS listingName, CONCAT(g.date, ' ', g.time) AS whenText, COALESCE(gp.total_cents, g.price_cents) AS amountCents, gp.payment_status AS paymentStatus, gp.status AS status, gp.joined_at AS createdAt, gp.resident_id AS residentId`,
    from: `game_participants gp LEFT JOIN games g ON g.id = gp.game_id LEFT JOIN residents res ON res.id = gp.resident_id`,
    ref: "COALESCE(gp.ref, CONCAT('#', gp.id))",
    email: "res.email",
    name: "res.name",
    listing: "g.activity_label",
    resident: "gp.resident_id",
    created: "gp.joined_at",
    extra: `g.location_text AS place, gp.attended AS attended`,
  },
  {
    kind: "experience",
    select: `eb.ref AS ref, eb.participant_name AS name, eb.email AS email, e.title AS listingName, CONCAT(es.date, ' ', es.time) AS whenText, eb.total_cents AS amountCents, eb.payment_status AS paymentStatus, eb.status AS status, eb.created_at AS createdAt, eb.resident_id AS residentId`,
    from: `experience_bookings eb LEFT JOIN experiences e ON e.id = eb.experience_id LEFT JOIN experience_sessions es ON es.id = eb.session_id`,
    ref: "eb.ref",
    email: "eb.email",
    name: "eb.participant_name",
    listing: "e.title",
    resident: "eb.resident_id",
    created: "eb.created_at",
    extra: `eb.phone AS phone, eb.party_size AS partySize`,
  },
  {
    kind: "pass",
    select: `ps.ref AS ref, res.name AS name, res.email AS email, COALESCE((SELECT c.name FROM centres c WHERE ps.listing_type = 'centre' AND c.id = ps.listing_id), (SELECT cl.name FROM clubs cl WHERE ps.listing_type = 'club' AND cl.id = ps.listing_id)) AS listingName, NULL AS whenText, ps.purchased_cents AS amountCents, ps.payment_status AS paymentStatus, NULL AS status, ps.created_at AS createdAt, ps.resident_id AS residentId`,
    from: `passes ps LEFT JOIN residents res ON res.id = ps.resident_id`,
    ref: "ps.ref",
    email: "res.email",
    name: "res.name",
    listing: "''",
    resident: "ps.resident_id",
    created: "ps.created_at",
    extra: `ps.credits_total AS creditsTotal, ps.credits_used AS creditsUsed, ps.expires_at AS expiresAt`,
  },
];

function normalise(kind: OrderKind, r: Record<string, unknown>): SupportOrder {
  return {
    kind,
    ref: String(r.ref ?? ""),
    name: (r.name as string) || null,
    email: (r.email as string) || null,
    listingName: (r.listingName as string) || null,
    whenText: (r.whenText as string) || null,
    amountCents: r.amountCents === null || r.amountCents === undefined ? null : Number(r.amountCents),
    paymentStatus: (r.paymentStatus as string) || null,
    status: (r.status as string) || null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    residentId: (r.residentId as string) || null,
  };
}

const newestFirst = (a: SupportOrder, b: SupportOrder) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

/** Orders matching a reference (exact), or part of an email, name or listing. Blank = most recent. */
export async function searchOrders(q: string, limit = 30): Promise<SupportOrder[]> {
  const like = `%${q}%`;
  const per = await Promise.all(
    SOURCES.map(async (s) => {
      const where = q ? `WHERE ${s.ref} = ? OR ${s.email} LIKE ? OR ${s.name} LIKE ? OR ${s.listing} LIKE ?` : "";
      const rows = (await db.prepare(`SELECT ${s.select} FROM ${s.from} ${where} ORDER BY ${s.created} DESC LIMIT ${limit}`).all(...(q ? [q, like, like, like] : []))) as Record<string, unknown>[];
      return rows.map((r) => normalise(s.kind, r));
    })
  );
  return per.flat().sort(newestFirst).slice(0, limit);
}

/** Every order placed with this email or by the resident account behind it. */
export async function ordersForPerson(email: string, residentId: string | null): Promise<SupportOrder[]> {
  const per = await Promise.all(
    SOURCES.map(async (s) => {
      const where = residentId ? `WHERE ${s.email} = ? OR ${s.resident} = ?` : `WHERE ${s.email} = ?`;
      const rows = (await db.prepare(`SELECT ${s.select} FROM ${s.from} ${where} ORDER BY ${s.created} DESC LIMIT 100`).all(...(residentId ? [email, residentId] : [email]))) as Record<string, unknown>[];
      return rows.map((r) => normalise(s.kind, r));
    })
  );
  return per.flat().sort(newestFirst);
}

export interface SupportOrderDetail {
  order: SupportOrder;
  extra: Record<string, unknown>;
  refunds: { amountMinor: number; currency: string; kind: string; status: string; reason: string; createdAt: string }[];
  /** An open D-10 payment review for this order (money received, not confirmed). */
  underReview: boolean;
}

export async function orderDetail(kind: OrderKind, ref: string): Promise<SupportOrderDetail | null> {
  const s = SOURCES.find((x) => x.kind === kind);
  if (!s) return null;
  const row = (await db.prepare(`SELECT ${s.select}, ${s.extra} FROM ${s.from} WHERE ${s.ref} = ? LIMIT 1`).get(ref)) as Record<string, unknown> | undefined;
  if (!row) return null;
  const order = normalise(kind, row);
  const base = new Set(["ref", "name", "email", "listingName", "whenText", "amountCents", "paymentStatus", "status", "createdAt", "residentId"]);
  const extra = Object.fromEntries(Object.entries(row).filter(([k]) => !base.has(k)));
  const refunds = (await db
    .prepare(`SELECT amount_minor AS amountMinor, currency, kind, status, reason, created_at AS createdAt FROM refunds WHERE source_type = ? AND source_ref = ? ORDER BY created_at DESC`)
    .all(kind, order.ref)) as SupportOrderDetail["refunds"];
  const review = (await db.prepare(`SELECT COUNT(*) AS n FROM payment_reviews WHERE source_type = ? AND source_ref = ? AND status = 'open'`).get(kind, order.ref)) as { n: number | string };
  return { order, extra, refunds: refunds.map((r) => ({ ...r, amountMinor: Number(r.amountMinor) })), underReview: Number(review.n) > 0 };
}

// --- OG-14 / OG-24 — the admin Orders directory, paged on the server -----------

export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page, or null at the end. */
  nextCursor: string | null;
}

/** Keyset cursor: newest first by (created_at, key). Base64url of "iso|key". */
export function encodeCursor(createdAt: string | Date, key: string): string {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  return Buffer.from(`${iso}|${key}`).toString("base64url");
}
export function decodeCursor(cursor: unknown): { at: Date; key: string } | null {
  if (typeof cursor !== "string" || !cursor) return null;
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const i = raw.indexOf("|");
  if (i < 0) return null;
  const at = new Date(raw.slice(0, i));
  return Number.isNaN(at.getTime()) ? null : { at, key: raw.slice(i + 1) };
}
export const pageLimit = (v: unknown, fallback = 25) => Math.min(100, Math.max(1, Number(v) || fallback));

export interface OrderFilters {
  kind?: OrderKind;
  status?: string;
  paymentStatus?: string;
  /** Created on/after, "YYYY-MM-DD". */
  from?: string;
  /** Created on/before, "YYYY-MM-DD". */
  to?: string;
  q?: string;
}

export async function listOrders(f: OrderFilters, cursor: unknown, limit: number): Promise<Page<SupportOrder>> {
  const after = decodeCursor(cursor);
  const sources = f.kind ? SOURCES.filter((s) => s.kind === f.kind) : SOURCES;
  const per = await Promise.all(
    sources.map(async (s) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (f.q) {
        const like = `%${f.q}%`;
        where.push(`(${s.ref} = ? OR ${s.email} LIKE ? OR ${s.name} LIKE ? OR ${s.listing} LIKE ?)`);
        params.push(f.q, like, like, like);
      }
      const statusCol = s.select.match(/(\S+) AS status/)?.[1];
      if (f.status && statusCol && statusCol !== "NULL") {
        where.push(`${statusCol} = ?`);
        params.push(f.status);
      }
      const payCol = s.select.match(/(\S+) AS paymentStatus/)?.[1];
      if (f.paymentStatus && payCol) {
        where.push(`${payCol} = ?`);
        params.push(f.paymentStatus);
      }
      if (f.from) {
        where.push(`${s.created} >= ?`);
        params.push(`${f.from} 00:00:00`);
      }
      if (f.to) {
        where.push(`${s.created} < DATE_ADD(?, INTERVAL 1 DAY)`);
        params.push(`${f.to} 00:00:00`);
      }
      if (after) {
        where.push(`(${s.created} < ? OR (${s.created} = ? AND ${s.ref} < ?))`);
        params.push(after.at, after.at, after.key);
      }
      const rows = (await db
        .prepare(`SELECT ${s.select} FROM ${s.from} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${s.created} DESC, ${s.ref} DESC LIMIT ${limit + 1}`)
        .all(...params)) as Record<string, unknown>[];
      return rows.map((r) => normalise(s.kind, r));
    })
  );
  const merged = per.flat().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.ref < b.ref ? 1 : a.ref > b.ref ? -1 : 0));
  const items = merged.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: merged.length > limit && last ? encodeCursor(last.createdAt, last.ref) : null };
}
