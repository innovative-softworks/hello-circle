import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { gamesRouter } from "../routes/games.js";
import { vendorFormsRouter } from "../routes/vendorForms.js";

// Phase N (docs/participation-expansion/24) — questions on a resident-hosted
// activity: approved library only (no own wording), at most three, host-only
// set-up and answers, checked at join (version and required), removed with
// the place, the switch off by default, host attendance (check-in and
// no-show, repeat-safe), and no route into the partner form builder.

let server: Server;
let base: string;
const t = crypto.randomUUID().slice(0, 8);
const host = `test-gq-host-${t}`;
const joiner = `test-gq-join-${t}`;
const other = `test-gq-other-${t}`;
const gameId = `test-gq-game-${t}`;
const date = new Date(Date.parse(`${irelandTodayIso()}T12:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10);

const call = async (method: string, path: string, resident: string, body?: unknown) => {
  const r = await fetch(`${base}/games/${gameId}${path}`, { method, headers: { "Content-Type": "application/json", "X-Test-Resident-Id": resident, "X-Client-Id": resident }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-Resident-Id");
    if (id) (req as any).resident = { id, name: id, email: `${id}@example.test` };
    const vendor = req.header("X-Test-Vendor");
    if (vendor) {
      (req as any).user = { id: vendor, role: "vendor", status: "approved", invitedStaff: false, platformRole: null };
      (req as any).vendorIds = [vendor];
    }
    next();
  });
  app.use("/games", gamesRouter);
  app.use("/vendor", vendorFormsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
  for (const id of [host, joiner, other]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, id);
  await db
    .prepare(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status, visibility, lifecycle) VALUES (?, ?, 'GQ Five-a-side', 'The Park', ?, '18:00', 10, 'open', 'public', 'active')`)
    .run(gameId, host, date);
  await db.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(gameId, host);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await setSetting("participation.host_questions", "false");
  await db.prepare(`DELETE FROM registration_answers WHERE source_type = 'game' AND source_ref LIKE ?`).run(`${gameId}:%`);
  await db.prepare(`DELETE FROM registration_questions WHERE listing_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM attendance WHERE kind = 'game' AND ref LIKE ?`).run(`${gameId}:%`);
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(gameId);
  await db.prepare(`DELETE FROM review_invitations WHERE source_ref LIKE ?`).run(`${gameId}:%`).catch(() => undefined);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(host, joiner, other);
});

describe("Phase N — host participation questions", () => {
  it("are off by default: nothing is asked and set-up is refused", async () => {
    await setSetting("participation.host_questions", "false");
    expect((await call("GET", "", joiner)).body.participationQuestions).toEqual({ questions: [], questionsVersion: 0 });
    expect((await call("PUT", "/questions", host, { picks: [{ key: "q_hostlevel" }] })).status).toBe(404);
  });

  it("only the host sets them, only from the library, at most three", async () => {
    await setSetting("participation.host_questions", "true");
    expect((await call("GET", "/questions", joiner)).status).toBe(403);
    expect((await call("PUT", "/questions", joiner, { picks: [{ key: "q_hostlevel" }] })).status).toBe(403);
    const lib = (await call("GET", "/questions", host)).body;
    expect(lib.library.map((l: { key: string }) => l.key)).toEqual(["q_hostlevel", "q_hostposition", "q_hostequip", "q_hostteam", "q_hostarrive"]);
    expect((await call("PUT", "/questions", host, { picks: [{ key: "q_medical", label: "Any allergies?" }] })).status).toBe(400);
    expect((await call("PUT", "/questions", host, { picks: ["q_hostlevel", "q_hostposition", "q_hostequip", "q_hostteam"].map((key) => ({ key })) })).status).toBe(400);
    const ok = await call("PUT", "/questions", host, { picks: [{ key: "q_hostlevel", required: true }, { key: "q_hostposition" }] });
    expect(ok.body).toMatchObject({ ok: true, version: 1 });
    expect((await call("GET", "", joiner)).body.participationQuestions.questions.map((q: { label: string }) => q.label)).toEqual(["Your level", "Preferred position"]);
  });

  it("are checked at join and visible to the host only", async () => {
    expect((await call("POST", "/join", joiner, {})).body.code).toBe("form_required");
    expect((await call("POST", "/join", joiner, { questionsVersion: 0 })).body.code).toBe("questions_changed");
    expect((await call("POST", "/join", joiner, { questionsVersion: 1, answers: { attendees: [{}] } })).status).toBe(400);
    const joined = await call("POST", "/join", joiner, { questionsVersion: 1, answers: { attendees: [{ q_hostlevel: "Intermediate", q_hostposition: "Goal" }] } });
    expect(joined.status).toBe(200);
    const manage = (await call("GET", "/participants/manage", host)).body;
    expect(manage.find((p: { residentId: string }) => p.residentId === joiner).answers.map((a: { label: string; value: string }) => [a.label, a.value])).toEqual([["Your level", "Intermediate"], ["Preferred position", "Goal"]]);
    expect((await call("GET", "/participants/manage", other)).status).toBe(403);
    const pub = JSON.stringify((await call("GET", "/participants", other)).body);
    expect(pub).not.toContain("Intermediate");
  });

  it("host attendance: check-in and no-show, repeat-safe, host only", async () => {
    expect((await call("POST", `/participants/${joiner}/no-show`, other)).status).toBe(403);
    expect((await call("POST", `/participants/${joiner}/no-show`, host)).status).toBe(200);
    expect((await call("POST", `/participants/${joiner}/no-show`, host)).status).toBe(200);
    const att = (await db.prepare(`SELECT status FROM attendance WHERE kind = 'game' AND ref = ?`).all(`${gameId}:${joiner}`)) as { status: string }[];
    expect(att).toEqual([{ status: "no_show" }]);
    expect((await call("POST", `/participants/${joiner}/check-in`, host)).status).toBe(200);
    expect(((await db.prepare(`SELECT status FROM attendance WHERE kind = 'game' AND ref = ?`).get(`${gameId}:${joiner}`)) as { status: string }).status).toBe("present");
    expect((await call("POST", `/participants/${other}/no-show`, host)).status).toBe(404);
  });

  it("leaving takes the answers with it", async () => {
    expect((await call("DELETE", "/join", joiner)).status).toBe(200);
    expect(await db.prepare(`SELECT id FROM registration_answers WHERE source_type = 'game' AND source_ref = ?`).get(`${gameId}:${joiner}`)).toBeUndefined();
  });

  it("the partner form builder can't be pointed at a game", async () => {
    const r = await fetch(`${base}/vendor/forms/game/${gameId}/questions`, { headers: { "X-Test-Vendor": host } });
    expect(r.status).toBe(404);
  });
});
