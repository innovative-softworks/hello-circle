import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test as base, expect, personas } from "./fixtures";
import { withActors as baseWithActors } from "./authorization-fixture";
import { connectedPreflight } from "./runtime";
import type { Scope } from "./stage-b-fixture";
import { notificationHref } from "../../client/src/notificationLink";

/** Fixture hygiene: every exact-ID cleanup entry registered through
 * withActors() is mirrored here, and the auto fixture below deletes them in
 * its teardown. Playwright runs fixture teardown even when a test TIMES OUT,
 * whereas a timed-out test body abandons withActors' own finally block (which
 * is what leaked rows during Phase 7 debugging). Deletes are exact-ID and
 * idempotent; the normal path has already removed them. */
const registry: { table: string; column: string; id: string | number }[] = [];
export function withActors(...args: Parameters<typeof baseWithActors>): ReturnType<typeof baseWithActors> {
  const [playwright, names, exercise] = args;
  return baseWithActors(playwright, names, (f) => exercise({ ...f, track: (table, column, id) => { registry.push({ table, column, id }); f.track(table, column, id); } }));
}
export const test = base.extend<{ lifecycleCleanup: void }>({
  lifecycleCleanup: [async ({}, use) => {
    registry.length = 0;
    await use();
    if (!registry.length) return;
    const safe = await connectedPreflight();
    try {
      for (const { table, column, id } of registry.splice(0).reverse()) {
        if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) throw new Error("Invalid cleanup scope");
        if (["games", "circles", "centres", "programs"].includes(table) && column === "id") {
          await safe.connection.execute("DELETE FROM analytics_events WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.id')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.circleId')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.gameId')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.listingId')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.entityId')) = ?", [id, id, id, id, id]);
        }
        if (table === "circle_polls" && column === "circle_id") {
          await safe.connection.execute("DELETE v FROM circle_poll_votes v JOIN circle_poll_options o ON o.id = v.option_id JOIN circle_polls p ON p.id = o.poll_id WHERE p.circle_id = ?", [id]);
          await safe.connection.execute("DELETE o FROM circle_poll_options o JOIN circle_polls p ON p.id = o.poll_id WHERE p.circle_id = ?", [id]);
        }
        await safe.connection.execute(`DELETE FROM ${table} WHERE ${column} = ?`, [id]);
      }
    } finally { await safe.connection.end(); }
  }, { auto: true }],
});

/** Phase 7 lifecycle helpers. Synthetic free activities only (no priceCents),
 * created through the real API as the real host session, cleaned up by exact
 * test-created IDs through withActors' tracked scope. */
export const FUTURE_DATE = "2030-07-15";

export function trackGame(f: Scope, id: string) {
  for (const [table, column] of [["games", "id"], ["game_participants", "game_id"], ["waitlist_entries", "listing_id"], ["listing_attributes", "listing_id"],
    ["notifications", "listing_id"], ["invitations", "entity_id"], ["game_updates", "game_id"], ["chat_messages", "scope_id"], ["chat_reads", "scope_id"],
    ["notify_me_subscriptions", "entity_id"], ["audit_log", "object_id"]]) f.track(table, column, id);
}

export function trackCircle(f: Scope, id: string) {
  for (const [table, column] of [["circles", "id"], ["circle_members", "circle_id"], ["circle_invites", "circle_id"], ["circle_plans", "circle_id"],
    ["circle_polls", "circle_id"], ["notifications", "listing_id"], ["chat_messages", "scope_id"], ["chat_reads", "scope_id"]]) f.track(table, column, id);
}

export async function createActivity(f: Scope, role: string, input: Record<string, unknown> = {}) {
  const label = `QA lifecycle ${randomUUID().slice(0, 8)}`;
  const response = await f.actors[role].post("/api/games", { data: {
    activityLabel: label, date: FUTURE_DATE, time: "18:30", capacity: 8, locationText: "QA synthetic park",
    description: "Synthetic Phase 7 lifecycle activity", ...input,
  } });
  expect(response.status(), "activity create").toBe(201);
  const body = await response.json();
  trackGame(f, body.id);
  return body as Record<string, any> & { id: string; activityLabel: string };
}

export async function createCircle(f: Scope, role: string, input: Record<string, unknown> = {}) {
  const response = await f.actors[role].post("/api/circles", { data: { name: `QA lifecycle circle ${randomUUID().slice(0, 8)}`, activityLabel: `QA circle activity ${randomUUID().slice(0, 6)}`, county: "Dublin", about: "Synthetic Phase 7 Circle", ...input } });
  expect(response.status(), "circle create").toBe(201);
  const body = await response.json() as { id: string; slug: string };
  trackCircle(f, body.id);
  return body;
}

export async function rows<T = any>(f: Scope, sql: string, values: unknown[] = []): Promise<T[]> {
  if (!/^SELECT /i.test(sql)) throw new Error("Lifecycle reads must be SELECT-only");
  const [result] = await f.connection.query<any[]>(sql, values);
  return result as T[];
}

export const participants = (f: Scope, game: string) =>
  rows<{ resident_id: string; status: string }>(f, "SELECT resident_id, status FROM game_participants WHERE game_id = ? ORDER BY id", [game]);
export const joinedIds = async (f: Scope, game: string) => (await participants(f, game)).filter(p => p.status === "joined").map(p => p.resident_id).sort();
export const waitlist = (f: Scope, game: string) =>
  rows<{ id: number; resident_id: string; status: string }>(f, "SELECT id, resident_id, status FROM waitlist_entries WHERE listing_type = 'game' AND listing_id = ? ORDER BY id", [game]);

/** Notifications for one persona about one listing, oldest first. */
export const notificationsFor = (f: Scope, role: string, listing: string) =>
  rows<{ id: number; kind: string; title: string; body: string; listing_type: string; listing_id: string; ref: string; read: number }>(f,
    "SELECT id, kind, title, body, listing_type, listing_id, ref, `read` FROM notifications WHERE resident_id = ? AND listing_id = ? ORDER BY id", [personas[role].id, listing]);

/** Notification navigation target, computed by the real client mapping. */
export const hrefOf = (n: { kind: string; listing_type: string; listing_id: string; ref: string }) =>
  notificationHref({ kind: n.kind as never, listingType: n.listing_type as never, listingId: n.listing_id, ref: n.ref });

export async function ids(actor: APIRequestContext, url: string, pick: (body: any) => any[] = b => b): Promise<string[]> {
  const response = await actor.get(url);
  expect(response.status(), url).toBe(200);
  return pick(await response.json()).map((item: any) => item.id);
}

/** All public/secondary activity surfaces an unrelated viewer can reach. */
export async function publicSurfaces(actor: APIRequestContext, host: string, circle?: string) {
  const profile = await (await actor.get(`/api/residents/${host}/host-profile`)).json();
  const surfaces: Record<string, string[]> = {
    list: await ids(actor, "/api/games"),
    hostProfile: (profile.upcomingGames ?? []).map((g: any) => g.id),
  };
  if (circle) {
    const upcoming = await actor.get(`/api/circles/${circle}/upcoming`);
    surfaces.circleUpcoming = upcoming.status() === 200 ? (await upcoming.json()).map((g: any) => g.id) : [];
  }
  return { surfaces, gamesHostedTotal: Number(profile.gamesHostedTotal) };
}

export function inSurfaces(s: Record<string, string[]>, id: string) {
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.includes(id)]));
}
