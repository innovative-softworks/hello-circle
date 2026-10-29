import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Page } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor, uiActor, noHorizontalScroll } from "../lifecycle-ui-fixture";
import { bookableClub } from "../booking-fixture";
import { setSwitches } from "../revenue-fixture";

// Phases I–L (docs/participation-expansion/20) end to end on a club
// registration: the resident sees their answers (version, locked answer),
// is told a new required question needs an answer, answers it on a phone;
// the partner owner reads the one record (answers, history); a finance member
// sees the record and the refund but not the answers; a check-in-only member
// can't open it; the Reports tab shows counts. Synthetic club of QA_VENDOR,
// free; QA_USER registers through the API.

const SHOTS = `${process.cwd()}/.qa-data/phase2-shots`;
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/config-${name}.png`, fullPage: true });

test("CFG-OPERATIONS: resident registration management, the partner record by role, and reports", async ({ playwright, browser }) => {
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_VENDOR", "QA_USER"], async (f) => {
    const restoreSwitches = await setSwitches(f.connection, { "participation.attendees": true });
    try {
      const clubId = await bookableClub(f, { price: 0, payment: "cash" });
      for (const [t, c] of [["registration_questions", "listing_id"], ["registration_form_drafts", "listing_id"], ["audit_log", "object_id"]]) f.track(t, c, clubId);
      const vendor = f.actors.QA_VENDOR;
      const Q = `/api/vendor/forms/club/${clubId}/questions`;
      const publish = async (questions: unknown[]) => {
        expect((await vendor.put(`${Q}/draft`, { data: { questions } })).status()).toBe(200);
        const r = await vendor.post(`${Q}/publish`);
        expect(r.status()).toBe(200);
        return (await r.json()) as { version: number; questions: { key: string; label: string }[] };
      };
      const kit = { scope: "attendee", inputType: "select", label: "Kit size", purpose: "So we order the right kit", choices: ["Small", "Medium", "Large"], required: true, editability: "locked" };
      const heard = { scope: "booking", inputType: "radio", label: "How did you hear about us?", purpose: "To know what works", choices: ["A friend", "Social media"] };
      const v1 = await publish([kit, heard]);
      const key = (label: string, qs: { key: string; label: string }[]) => qs.find((q) => q.label === label)!.key;

      // QA_USER registers their child with the version-1 answers, under their own email (as the web flow does).
      const clientId = randomUUID();
      const [me] = await rows(f, "SELECT email FROM residents WHERE id = ?", [personas.QA_USER.id]);
      const reg = await f.actors.QA_USER.post("/api/registrations/checkout", {
        headers: { "X-Client-Id": clientId },
        data: {
          clubId, registrantType: "child", team: "U10", childFirst: "Aoife", childLast: `Ops${randomUUID().slice(0, 4)}`, dob: "2016-05-01", gFirst: "QA", gLast: "Parent", email: String(me.email), phone: "0850000000", address: "",
          ecName: "QA Gran", ecPhone: "0850000001", ecRel: "Grandparent", consent: true, trial: false, acceptedTerms: true,
          questionsVersion: v1.version, answers: { booking: { [key("How did you hear about us?", v1.questions)]: "A friend" }, attendees: [{ [key("Kit size", v1.questions)]: "Medium" }] },
        },
      });
      expect(reg.status()).toBe(201);
      const ref = (await reg.json()).ref as string;
      for (const [t, c] of [["registration_answers", "source_ref"], ["order_acknowledgements", "source_ref"], ["audit_log", "object_id"], ["notifications", "ref"]]) f.track(t, c, ref);
      // Version 2 adds a required question this registration hasn't answered.
      const v2 = await publish([{ ...kit, key: key("Kit size", v1.questions) }, { ...heard, key: key("How did you hear about us?", v1.questions) }, { scope: "booking", inputType: "text", label: "Name on the shirt", purpose: "Printed on the kit", required: true }]);

      // --- resident on a phone ------------------------------------------------
      const resident = await uiActor(browser, "QA_USER", "mobile");
      try {
        const { page } = resident;
        page.setDefaultTimeout(15_000);
        await page.goto(`/bookings/registration/${ref}`);
        const section = page.getByRole("region", { name: "Your registration" }).or(page.locator("section", { has: page.getByRole("heading", { name: "Your registration" }) })).first();
        await expect(section.getByText(/Needs your attention/)).toBeVisible();
        await expect(section.getByText(/Name on the shirt/).first()).toBeVisible();
        await expect(section.getByText(/Answered on form version 1/)).toBeVisible();
        await expect(section.getByText(/can't be changed/)).toBeVisible();
        expect(await noHorizontalScroll(page)).toBe(true);
        await shot(page, "30-resident-registration-attention-phone");
        await section.getByRole("button", { name: "Answer now" }).click();
        // The locked answer can't be edited; the new one can.
        await expect(section.getByLabel(/^Kit size/)).toBeDisabled();
        await section.getByLabel(/^Name on the shirt/).fill("AOIFE");
        await section.getByRole("button", { name: "Save answers" }).click();
        await expect(section.getByText(/Needs your attention/)).toHaveCount(0);
        await expect(section.getByText("AOIFE", { exact: true })).toBeVisible();
        await shot(page, "31-resident-answers-saved-phone");
        expect(resident.consoleErrors).toEqual([]);
      } finally { await resident.close(); }
      const saved = await rows(f, "SELECT qkey, value_text, questions_version FROM registration_answers WHERE source_type = 'registration' AND source_ref = ? ORDER BY attendee_no, qkey", [ref]);
      expect(saved.find((a) => a.value_text === "AOIFE")).toMatchObject({ questions_version: v2.version });
      expect(saved.find((a) => a.value_text === "Medium")).toMatchObject({ questions_version: v1.version });
      const [note] = await rows(f, "SELECT title, body FROM notifications WHERE ref = ? AND title LIKE 'Registration answers updated%'", [ref]);
      expect(String(note.body)).not.toContain("AOIFE");

      // --- partner owner: the one record ----------------------------------------
      const owner = await staffActor(browser, "QA_VENDOR");
      try {
        const { page } = owner;
        page.setDefaultTimeout(15_000);
        await page.goto(`/vendor/orders/registration/${ref}`);
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Aoife");
        await expect(page.getByText("AOIFE", { exact: true })).toBeVisible();
        await expect(page.getByText(/Answers changed by the person who booked/)).toBeVisible();
        await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
        await shot(page, "32-partner-record-owner");
        await page.goto("/vendor?tab=reports");
        await expect(page.getByRole("heading", { name: "Registrations by listing type" })).toBeVisible();
        await shot(page, "34-partner-reports");
        expect(owner.consoleErrors).toEqual([]);
      } finally { await owner.close(); }

      // --- a finance member and a check-in-only member of the same organisation ---
      const [org] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
      const member = async (role: string, label: string) => {
        const id = randomUUID(), password = randomBytes(24).toString("hex"), email = `qa_ops_${role}_${id.slice(0, 6)}@example.test`;
        await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, org_id, platform_role, invited_staff) VALUES (?, ?, ?, 'vendor', 'approved', ?, ?, ?, 1)", [id, email, bcrypt.hashSync(password, 10), label, org.org_id, role]);
        f.track("users", "id", id); f.track("sessions", "user_id", id); f.track("audit_log", "actor_user_id", id);
        return { email, password };
      };
      const fin = await staffActor(browser, "QA_FINANCE", { credentials: await member("finance", "QA Ops Finance") });
      try {
        const { page } = fin;
        page.setDefaultTimeout(15_000);
        expect((await fin.context.request.post("/api/auth/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
        const api = await (await page.request.get(`/api/vendor/orders/registration/${ref}`)).json();
        expect([api.answersVisible, api.answers]).toEqual([false, null]);
        expect(JSON.stringify(api)).not.toContain("AOIFE");
        await page.goto(`/vendor/orders/registration/${ref}`);
        await expect(page.getByText(/Only the managers who run this listing can read them/)).toBeVisible();
        await expect(page.getByText("AOIFE", { exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Issue refund" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
        await shot(page, "33-partner-record-finance");
        expect((await page.request.get(`/api/vendor/forms/club/${clubId}/answers.csv`)).status()).toBe(403);
      } finally { await fin.close(); }
      const door = await staffActor(browser, "QA_DOOR", { credentials: await member("checkin_staff", "QA Ops Door") });
      try {
        expect((await door.context.request.post("/api/auth/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
        for (const path of [`/api/vendor/orders/registration/${ref}`, "/api/vendor/reports/participation", `/api/vendor/forms/club/${clubId}/answers`]) {
          expect([path, (await door.page.request.get(path)).status()]).toEqual([path, 403]);
        }
      } finally { await door.close(); }
    } finally {
      await restoreSwitches();
    }
  });
});
