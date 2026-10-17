import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("./email.js", async (orig) => ({ ...(await orig<typeof import("./email.js")>()), sendMail: async (m: { to: string; subject: string; text: string }) => void sent.push(m) }));

const { db } = await import("./db/index.js");
const { recordConsent } = await import("./consent.js");
const { consentsForEmail, listPrivacyRequests, myPrivacyRequests, privacyRequestDetail, submitPrivacyRequest, updatePrivacyRequest } = await import("./privacyRequests.js");

// OG-29 / OG-31 — privacy requests are recorded and answered, never acted on
// automatically; the consent viewer reads a person's own records.

const t = crypto.randomUUID().slice(0, 8);
const resident = { id: `test-priv-${t}`, email: `priv-${t}@example.test` };
const admin = `test-priv-admin-${t}`;

beforeAll(async () => {
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Priv Person')`).run(resident.id, resident.email);
  await recordConsent({ type: "resident", id: resident.id }, "marketing_email", true, "test");
});

afterAll(async () => {
  await db.prepare(`DELETE FROM privacy_requests WHERE resident_id = ?`).run(resident.id);
  await db.prepare(`DELETE FROM consent_records WHERE subject_id = ?`).run(resident.id);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(resident.id);
});

describe("privacy requests", () => {
  let id = 0;
  it("records a request, once per open kind, and acknowledges it", async () => {
    await expect(submitPrivacyRequest(resident, "nonsense", "")).rejects.toThrow(/Choose/);
    ({ id } = await submitPrivacyRequest(resident, "erasure", "Please delete my account"));
    await expect(submitPrivacyRequest(resident, "erasure", "again")).rejects.toThrow(/already have an open request/);
    expect(sent.some((m) => m.to === resident.email && m.text.includes(`PR-${id}`))).toBe(true);
    expect(await myPrivacyRequests(resident.id)).toEqual([expect.objectContaining({ id, kind: "erasure", status: "received" })]);
    expect(((await listPrivacyRequests("open")) as { id: number }[]).some((r) => r.id === id)).toBe(true);
  });

  it("closing needs a reply, emails it, and deletes nothing", async () => {
    await expect(updatePrivacyRequest(id, admin, "completed", "short")).rejects.toThrow(/at least 10/);
    await updatePrivacyRequest(id, admin, "in_progress", "");
    await updatePrivacyRequest(id, admin, "completed", "We've recorded your request; deletion follows our published rules.");
    await expect(updatePrivacyRequest(id, admin, "refused", "Changing my mind here")).rejects.toThrow(/already closed/);
    expect(sent.at(-1)).toMatchObject({ to: resident.email });
    expect(await db.prepare(`SELECT id FROM residents WHERE id = ?`).get(resident.id)).toBeTruthy();
    expect(await privacyRequestDetail(id)).toMatchObject({ status: "completed", consents: { marketing_email: expect.objectContaining({ granted: true }) } });
  });
});

describe("consent viewer", () => {
  it("shows the current choice and history for an email", async () => {
    const subjects = await consentsForEmail(resident.email.toUpperCase());
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toMatchObject({ kind: "resident", current: { marketing_email: expect.objectContaining({ granted: true }) } });
    expect(subjects[0].history.length).toBeGreaterThan(0);
    expect(await consentsForEmail(`nobody-${t}@example.test`)).toEqual([]);
  });
});
