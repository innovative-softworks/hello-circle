import { db } from "./db/index.js";
import { irelandTodayIso } from "./irelandTime.js";
import { decodeCursor, encodeCursor, type Page } from "./supportLookup.js";

// OG-14 / OG-24 — the admin Operations directories (People, Activities,
// Circles, Hosts), paged on the server, newest first with a stable keyset
// cursor. Read-only: each row opens an existing record page, where any action
// is permission-checked on its own route. Orders live in supportLookup.ts.

function keyset(createdCol: string, idCol: string, cursor: unknown, where: string[], params: unknown[]) {
  const after = decodeCursor(cursor);
  if (after) {
    where.push(`(${createdCol} < ? OR (${createdCol} = ? AND ${idCol} < ?))`);
    params.push(after.at, after.at, after.key);
  }
}

function paged<T extends { createdAt: string | Date }>(rows: T[], limit: number, keyOf: (r: T) => string): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, keyOf(last)) : null };
}

const whereSql = (w: string[]) => (w.length ? `WHERE ${w.join(" AND ")}` : "");

// --- People (residents) ---------------------------------------------------------

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  county: string;
  hostStatus: string;
  deactivated: boolean;
  createdAt: string;
}

export async function listPeople(f: { q?: string; filter?: "host" | "verified_host" | "deactivated" }, cursor: unknown, limit: number): Promise<Page<PersonRow>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    where.push(`(r.email LIKE ? OR r.name LIKE ?)`);
    params.push(`%${f.q}%`, `%${f.q}%`);
  }
  if (f.filter === "verified_host") where.push(`r.host_status = 'verified'`);
  if (f.filter === "host") where.push(`EXISTS (SELECT 1 FROM games g WHERE g.host_resident_id = r.id)`);
  if (f.filter === "deactivated") where.push(`r.deactivated_at IS NOT NULL`);
  keyset("r.created_at", "r.id", cursor, where, params);
  const rows = (await db
    .prepare(
      `SELECT r.id, r.name, r.email, r.home_county as county, r.host_status as hostStatus, r.deactivated_at IS NOT NULL as deactivated, r.created_at as createdAt
       FROM residents r ${whereSql(where)} ORDER BY r.created_at DESC, r.id DESC LIMIT ${limit + 1}`
    )
    .all(...params)) as (Omit<PersonRow, "deactivated"> & { deactivated: number })[];
  return paged(rows.map((r) => ({ ...r, deactivated: Number(r.deactivated) === 1 })), limit, (r) => r.id);
}

// --- Activities (games) -----------------------------------------------------------

export interface ActivityRow {
  id: string;
  activityLabel: string;
  date: string;
  time: string;
  status: string;
  lifecycle: string;
  hostResidentId: string;
  hostName: string | null;
  place: string;
  capacity: number;
  joined: number;
  priceCents: number | null;
  reports: number;
  createdAt: string;
}

export async function listActivities(f: { q?: string; status?: string; when?: "upcoming" | "past" }, cursor: unknown, limit: number): Promise<Page<ActivityRow>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    where.push(`(g.activity_label LIKE ? OR r.name LIKE ? OR r.email LIKE ?)`);
    params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  if (f.status) {
    where.push(`g.status = ?`);
    params.push(f.status);
  }
  if (f.when === "upcoming") {
    where.push(`g.date >= ?`);
    params.push(irelandTodayIso());
  }
  if (f.when === "past") {
    where.push(`g.date < ?`);
    params.push(irelandTodayIso());
  }
  keyset("g.created_at", "g.id", cursor, where, params);
  const rows = (await db
    .prepare(
      `SELECT g.id, g.activity_label as activityLabel, g.date, g.time, g.status, g.lifecycle, g.host_resident_id as hostResidentId, r.name as hostName,
              COALESCE(c.name, g.location_text) as place, g.capacity, g.price_cents as priceCents, g.created_at as createdAt,
              (SELECT COUNT(*) FROM game_participants p WHERE p.game_id = g.id AND p.status = 'joined') as joined,
              (SELECT COUNT(*) FROM reports rp WHERE rp.target_type = 'game' AND rp.target_id = g.id) as reports
       FROM games g LEFT JOIN residents r ON r.id = g.host_resident_id LEFT JOIN centres c ON c.id = g.centre_id
       ${whereSql(where)} ORDER BY g.created_at DESC, g.id DESC LIMIT ${limit + 1}`
    )
    .all(...params)) as ActivityRow[];
  return paged(rows.map((r) => ({ ...r, joined: Number(r.joined), reports: Number(r.reports), capacity: Number(r.capacity) })), limit, (r) => r.id);
}

export async function activityDetail(id: string) {
  const row = (await db
    .prepare(
      `SELECT g.id, g.activity_label as activityLabel, g.date, g.time, g.status, g.lifecycle, g.visibility, g.host_resident_id as hostResidentId, r.name as hostName, r.email as hostEmail,
              COALESCE(c.name, g.location_text) as place, g.centre_id as centreId, g.booking_ref as bookingRef, g.capacity, g.price_cents as priceCents, g.circle_id as circleId, g.created_at as createdAt
       FROM games g LEFT JOIN residents r ON r.id = g.host_resident_id LEFT JOIN centres c ON c.id = g.centre_id WHERE g.id = ?`
    )
    .get(id)) as Record<string, unknown> | undefined;
  if (!row) return null;
  const participants = (await db
    .prepare(
      `SELECT p.resident_id as residentId, res.name, res.email, p.status, p.payment_status as paymentStatus, p.total_cents as totalCents, p.joined_at as joinedAt, p.checked_in_at as checkedInAt
       FROM game_participants p LEFT JOIN residents res ON res.id = p.resident_id WHERE p.game_id = ? ORDER BY p.joined_at`
    )
    .all(id)) as Record<string, unknown>[];
  const reports = (await db.prepare(`SELECT id, reason, status, created_at as createdAt FROM reports WHERE target_type = 'game' AND target_id = ? ORDER BY created_at DESC`).all(id)) as Record<string, unknown>[];
  return { activity: row, participants, reports };
}

// --- Circles -----------------------------------------------------------------------

export interface CircleRow {
  id: string;
  slug: string | null;
  name: string;
  activityLabel: string;
  county: string;
  status: string;
  joinMode: string;
  members: number;
  organiserName: string | null;
  reports: number;
  createdAt: string;
}

export async function listCircles(f: { q?: string; status?: string }, cursor: unknown, limit: number): Promise<Page<CircleRow>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    where.push(`(c.name LIKE ? OR c.activity_label LIKE ?)`);
    params.push(`%${f.q}%`, `%${f.q}%`);
  }
  if (f.status) {
    where.push(`c.status = ?`);
    params.push(f.status);
  }
  keyset("c.created_at", "c.id", cursor, where, params);
  const rows = (await db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.activity_label as activityLabel, c.county, c.status, c.join_mode as joinMode, c.created_at as createdAt,
              (SELECT COUNT(*) FROM circle_members m WHERE m.circle_id = c.id) as members,
              (SELECT r.name FROM residents r WHERE r.id = c.created_by_resident_id) as organiserName,
              (SELECT COUNT(*) FROM reports rp WHERE rp.target_type = 'circle' AND rp.target_id = c.id) as reports
       FROM circles c ${whereSql(where)} ORDER BY c.created_at DESC, c.id DESC LIMIT ${limit + 1}`
    )
    .all(...params)) as CircleRow[];
  return paged(rows.map((r) => ({ ...r, members: Number(r.members), reports: Number(r.reports) })), limit, (r) => r.id);
}

// --- Hosts (residents who have hosted, or applied for the badge) ----------------------

export interface HostRow {
  id: string;
  name: string;
  email: string;
  hostStatus: string;
  hosted: number;
  upcoming: number;
  paidActivities: number;
  createdAt: string;
}

export async function listHosts(f: { q?: string; status?: string }, cursor: unknown, limit: number): Promise<Page<HostRow>> {
  const where: string[] = [`(r.host_status != 'none' OR EXISTS (SELECT 1 FROM games g WHERE g.host_resident_id = r.id))`];
  const params: unknown[] = [];
  if (f.q) {
    where.push(`(r.email LIKE ? OR r.name LIKE ?)`);
    params.push(`%${f.q}%`, `%${f.q}%`);
  }
  if (f.status) {
    where.push(`r.host_status = ?`);
    params.push(f.status);
  }
  keyset("r.created_at", "r.id", cursor, where, params);
  const rows = (await db
    .prepare(
      `SELECT r.id, r.name, r.email, r.host_status as hostStatus, r.created_at as createdAt,
              (SELECT COUNT(*) FROM games g WHERE g.host_resident_id = r.id) as hosted,
              (SELECT COUNT(*) FROM games g WHERE g.host_resident_id = r.id AND g.status != 'cancelled' AND g.date >= ?) as upcoming,
              (SELECT COUNT(*) FROM games g WHERE g.host_resident_id = r.id AND g.price_cents > 0) as paidActivities
       FROM residents r ${whereSql(where)} ORDER BY r.created_at DESC, r.id DESC LIMIT ${limit + 1}`
    )
    .all(irelandTodayIso(), ...params)) as HostRow[];
  return paged(rows.map((r) => ({ ...r, hosted: Number(r.hosted), upcoming: Number(r.upcoming), paidActivities: Number(r.paidActivities) })), limit, (r) => r.id);
}
