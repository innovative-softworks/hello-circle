import { randomUUID } from "node:crypto";
import { expect, personas } from "./fixtures";
import type { Scope } from "./stage-b-fixture";

export async function closureGame(f: Scope, extra: Record<string, unknown> = {}) {
  const response = await f.actors.QA_HOST.post("/api/games", { data: {
    activityLabel: `QA closure ${randomUUID()}`, date: "2030-06-20", time: "12:00", capacity: 12,
    locationText: "Synthetic QA", visibility: "invite", lifecycle: "active", priceCents: 0, ...extra,
  } });
  expect(response.status()).toBe(201);
  const id = (await response.json()).id as string;
  for (const [table, column] of [["games", "id"], ["game_participants", "game_id"], ["invitations", "entity_id"], ["notifications", "listing_id"], ["listing_attributes", "listing_id"], ["waitlist_entries", "listing_id"], ["game_updates", "game_id"], ["chat_messages", "scope_id"], ["chat_reads", "scope_id"]]) f.track(table, column, id);
  return id;
}

export async function closureInvite(f: Scope, game: string, opts: { emailOnly?: boolean; status?: string; expired?: boolean } = {}) {
  const id = randomUUID(), token = randomUUID();
  const [residents] = await f.connection.query<any[]>("SELECT email FROM residents WHERE id = ?", [personas.QA_USER.id]);
  await f.connection.execute(`INSERT INTO invitations (id, token, entity_type, entity_id, inviter_resident_id, invitee_resident_id, invitee_email, status, expires_at)
    VALUES (?, ?, 'game', ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${opts.expired ? "-1" : "1"} DAY))`,
    [id, token, game, personas.QA_HOST.id, opts.emailOnly ? null : personas.QA_USER.id, opts.emailOnly ? residents[0].email : null, opts.status ?? "pending"]);
  return { id, token };
}
