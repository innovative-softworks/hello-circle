import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { registrationsRouter } from "./routes/registrations.js";
import { cleanQuestionSet, QuestionError } from "./participation/questions.js";

// Privacy decision D-A4 (2026-10-29, docs/participation-expansion/15): free-text
// health information is no longer collected, existing values are kept but read
// by nothing, and dynamic fields can't be used to collect it instead.

let server: Server;
let base: string;
const clubId = `test-club-dpa4-${crypto.randomUUID()}`;
const sessionId = `test-session-dpa4-${crypto.randomUUID()}`;
const legacyRef = `CR-DPA4-${crypto.randomUUID().slice(0, 6)}`;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", registrationsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
  await db.prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb) VALUES (?, 'DPA4 Club', 'Testball', 'Area', 'Dublin', '5-12', 0, 'year', 1, '', '', '')`).run(clubId);
  await db.prepare(`INSERT INTO club_sessions (id, club_id, day_of_week, time, capacity, label, active) VALUES (?, ?, 1, '18:00', NULL, 'S', 1)`).run(sessionId, clubId);
  // A registration made before the change, with a health note.
  await db
    .prepare(
      `INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents)
       VALUES (?, 'c', ?, 'T', 'Old', 'Record', '2015-01-01', 'G', 'G', 'old@example.test', '0', 'A', 'E', '0', 'P', 'Legacy note: asthma inhaler', 1, 0, 0)`
    )
    .run(legacyRef, clubId);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM registrations WHERE club_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM club_sessions WHERE club_id = ?`).run(clubId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
});

describe("D-A4 — no new free-text health information", () => {
  it("a registration that still sends a medical note books, but the note is never stored", async () => {
    const res = await fetch(`${base}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": `dpa4-${crypto.randomUUID()}` },
      body: JSON.stringify({ clubId, sessionId, team: "T", childFirst: "New", childLast: "Child", dob: "2015-01-01", gFirst: "G", gLast: "G", email: "new@example.test", phone: "0850000000", address: "A", ecName: "E", ecPhone: "0", ecRel: "P", medical: "Peanut allergy, carries an EpiPen", consent: true, trial: false }),
    });
    expect(res.status).toBe(201);
    const { ref } = (await res.json()) as { ref: string };
    const row = (await db.prepare(`SELECT medical FROM registrations WHERE ref = ?`).get(ref)) as { medical: string };
    expect(row.medical).toBe("");
  });

  it("existing notes are kept untouched (no automatic deletion) pending the privacy review", async () => {
    const row = (await db.prepare(`SELECT medical FROM registrations WHERE ref = ?`).get(legacyRef)) as { medical: string };
    expect(row.medical).toBe("Legacy note: asthma inhaler");
  });

  it("no server code reads the medical column (it's only ever written, as empty)", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !p.includes(`${path.sep}scripts${path.sep}`)) {
          const text = fs.readFileSync(p, "utf8");
          // Any SELECT, export or JSON field that mentions the column.
          for (const m of text.matchAll(/SELECT[\s\S]{0,400}?\bFROM\s+registrations\b/gi)) if (/\bmedical\b/.test(m[0])) offenders.push(`${path.relative(root, p)}: SELECT`);
          if (/\b(r|reg|row|registration)\.medical\b/.test(text)) offenders.push(`${path.relative(root, p)}: field read`);
          if (/medical:\s*body\.medical/.test(text)) offenders.push(`${path.relative(root, p)}: stores body.medical`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it("dynamic questions can't collect it instead: wording, hint, purpose and choices are all checked", () => {
    const refused = (q: Record<string, unknown>) => {
      try {
        cleanQuestionSet([{ scope: "attendee", inputType: "text", label: "Anything else?", purpose: "To help on the day", ...q }], false);
        return false;
      } catch (e) {
        return e instanceof QuestionError && e.code === "special_category";
      }
    };
    expect(refused({ label: "Anything the coach should know (medical)?" })).toBe(true);
    expect(refused({ help: "e.g. allergies or medication" })).toBe(true);
    expect(refused({ purpose: "So we know who needs an inhaler" })).toBe(true);
    expect(refused({ inputType: "select", choices: ["None", "Peanut allergy", "Other"] })).toBe(true);
    expect(refused({ inputType: "checkbox", label: "Carries an EpiPen" })).toBe(true);
    expect(refused({ category: "health" })).toBe(true);
    expect(refused({ label: "T-shirt size", inputType: "select", choices: ["S", "M", "L"] })).toBe(false);
  });
});
