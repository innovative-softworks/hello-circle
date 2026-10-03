import { db } from "./db/index.js";
import { irelandTodayIso } from "./irelandTime.js";
import { DISCOVERABLE_LIFECYCLES_SQL, getEffectiveLifecycle, type Lifecycle } from "./lifecycle.js";

export interface GameVisibilityRow {
  id: string;
  host_resident_id: string;
  circle_id: string | null;
  visibility: string;
  status: string;
  date: string;
  lifecycle: string;
  publish_at: string | null;
  booking_open_at: string | null;
  booking_close_at: string | null;
}

export function getEffectiveGameLifecycle(row: Pick<GameVisibilityRow, "status" | "date" | "lifecycle" | "publish_at" | "booking_open_at" | "booking_close_at">, now = new Date()): Lifecycle {
  if (row.status === "cancelled") return "cancelled";
  if (row.date < irelandTodayIso()) return "completed";
  return getEffectiveLifecycle({ lifecycle: row.lifecycle as Lifecycle, publishAt: row.publish_at, bookingOpenAt: row.booking_open_at, bookingCloseAt: row.booking_close_at }, now);
}

export async function canViewPrivateGame(gameId: string, circleId: string | null, viewerResidentId: string | null, hostResidentId: string): Promise<boolean> {
  if (!viewerResidentId) return false;
  if (viewerResidentId === hostResidentId) return true;
  if (await db.prepare(`SELECT 1 FROM game_participants WHERE game_id = ? AND resident_id = ? AND status = 'joined'`).get(gameId, viewerResidentId)) return true;
  if (circleId && await db.prepare(`SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(circleId, viewerResidentId)) return true;
  return !!await db.prepare(`SELECT 1 FROM invitations WHERE entity_type = 'game' AND entity_id = ? AND invitee_resident_id = ?
    AND status IN ('pending', 'accepted', 'maybe') AND expires_at > NOW()`).get(gameId, viewerResidentId);
}

/** Canonical DETAIL policy — the reference every secondary read (children,
 * aggregations, feeds) must not exceed. Draft, including scheduled-but-not-
 * yet-published (future publish_at), is host-only; non-public visibility needs
 * a relationship (host, joined participant, Circle member, invitee). Age or
 * cancellation must not publish a draft. */
export async function canViewGame(row: GameVisibilityRow, viewerId: string | null): Promise<boolean> {
  const lifecycle = getEffectiveLifecycle({ lifecycle: row.lifecycle as Lifecycle, publishAt: row.publish_at, bookingOpenAt: row.booking_open_at, bookingCloseAt: row.booking_close_at });
  if (lifecycle === "draft" && row.host_resident_id !== viewerId) return false;
  return row.visibility === "public" || canViewPrivateGame(row.id, row.circle_id, viewerId, row.host_resident_id);
}

/** Loads a game only when `viewerId` may see it under canViewGame(); null is
 * indistinguishable from "doesn't exist" so callers can 404 either way. */
export async function loadViewableGame(id: string, viewerId: string | null): Promise<(GameVisibilityRow & Record<string, unknown>) | null> {
  const row = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(id)) as (GameVisibilityRow & Record<string, unknown>) | undefined;
  return row && (await canViewGame(row, viewerId)) ? row : null;
}

/** Canonical DISCOVERY policy as SQL — for lists, profiles, recommendations and
 * public counts shown to callers with no relationship to the activity: public
 * visibility, a discoverable stored lifecycle, and publish_at reached (the SQL
 * twin of getEffectiveLifecycle()'s "future publishAt behaves as draft").
 * Callers still add their own status/date window. Relationship-based views
 * (host, participant, Circle member) use canViewGame() per row instead. */
export function discoverableGameSql(alias = "g"): string {
  const a = alias ? `${alias}.` : "";
  return `${a}visibility = 'public' AND ${a}lifecycle IN ${DISCOVERABLE_LIFECYCLES_SQL} AND (${a}publish_at IS NULL OR ${a}publish_at <= UTC_TIMESTAMP())`;
}

/** Columns canViewGame() needs, for SELECTs that don't use `g.*`. */
export const GAME_VISIBILITY_COLUMNS = (alias = "g") =>
  ["id", "host_resident_id", "circle_id", "visibility", "status", "date", "lifecycle", "publish_at", "booking_open_at", "booking_close_at"].map((c) => `${alias}.${c} AS __v_${c}`).join(", ");

/** Rebuilds a GameVisibilityRow from GAME_VISIBILITY_COLUMNS aliases. */
export function visibilityRowFrom(row: Record<string, unknown>): GameVisibilityRow {
  const get = (c: string) => row[`__v_${c}`] as never;
  return { id: get("id"), host_resident_id: get("host_resident_id"), circle_id: get("circle_id"), visibility: get("visibility"), status: get("status"), date: get("date"), lifecycle: get("lifecycle"), publish_at: get("publish_at"), booking_open_at: get("booking_open_at"), booking_close_at: get("booking_close_at") };
}

/** Removes the __v_* helper columns before a row is returned to a client. */
export function withoutVisibilityColumns<T extends Record<string, unknown>>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("__v_"))) as T;
}

/** Keeps only rows the viewer may see under canViewGame(). */
export async function filterViewable<T extends Record<string, unknown>>(rows: T[], viewerId: string | null): Promise<T[]> {
  const kept: T[] = [];
  for (const row of rows) if (await canViewGame(visibilityRowFrom(row), viewerId)) kept.push(withoutVisibilityColumns(row));
  return kept;
}
