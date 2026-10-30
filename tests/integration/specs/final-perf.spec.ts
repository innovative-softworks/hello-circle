import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { env, expect } from "../fixtures";
import { test, withActors } from "../lifecycle-fixture";
import { bookableClub } from "../booking-fixture";
import { setSwitches } from "../revenue-fixture";

// Final validation (docs/participation-expansion/final-validation/10): server
// response times for the participation paths on the isolated QA stack (dev
// server, local MySQL container, one machine). Measurements, not thresholds:
// the only assertions are that every call succeeds and nothing is duplicated.
// Results go to .qa-data/final-perf.json for the report.

const N = 30;
type Stat = { n: number; p50: number; p95: number; max: number };
const stat = (ms: number[]): Stat => {
  const s = [...ms].sort((a, b) => a - b);
  const at = (p: number) => Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]);
  return { n: s.length, p50: at(50), p95: at(95), max: Math.round(s[s.length - 1]) };
};
async function timed(call: () => Promise<APIResponse>, ok = [200, 201]): Promise<{ ms: number; res: APIResponse }> {
  const t = performance.now();
  const res = await call();
  const ms = performance.now() - t;
  expect(ok, `${res.url()} → ${res.status()}`).toContain(res.status());
  return { ms, res };
}
async function measure(call: () => Promise<APIResponse>, n = N): Promise<Stat> {
  await call(); // warm-up
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await timed(call)).ms);
  return stat(out);
}
const backendRssMb = () => {
  try {
    const port = new URL(env.E2E_API_URL).port;
    const pid = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`).toString().trim().split("\n")[0];
    return Math.round(Number(execSync(`ps -o rss= -p ${pid}`).toString().trim()) / 1024);
  } catch { return null; }
};

test("FINAL-PERF: response times for explore, listing, form, registration, confirmation, attendees, check-in, reports, exports and messages", async ({ playwright }) => {
  test.setTimeout(600_000);
  await withActors(playwright, ["GUEST", "QA_VENDOR"], async (f) => {
    const restoreSwitches = await setSwitches(f.connection, { "participation.attendees": true });
    try {
      const results: Record<string, unknown> = { measuredAt: new Date().toISOString(), samplesPerPath: N, rssStartMb: backendRssMb() };
      const vendor = f.actors.QA_VENDOR;
      const guest: APIRequestContext = f.actors.GUEST;
      const clubId = await bookableClub(f, { price: 0, payment: "cash", capacity: null });
      for (const [t, c] of [["registration_questions", "listing_id"], ["registration_form_drafts", "listing_id"], ["audit_log", "object_id"], ["registrations", "club_id"], ["vendor_messages", "listing_id"]]) f.track(t, c, clubId);
      const Q = `/api/vendor/forms/club/${clubId}/questions`;
      const questions = [
        { scope: "booking", inputType: "text", label: "Team name", purpose: "Bib", exportable: true, required: true },
        { scope: "booking", inputType: "select", label: "Kit size", purpose: "Kit", choices: ["S", "M", "L"], exportable: true },
        { scope: "booking", inputType: "radio", label: "Level", purpose: "Grouping", choices: ["New", "Some", "Lots"] },
        { scope: "booking", inputType: "checkbox", label: "Photos are fine", purpose: "Consent to team photos" },
        { scope: "booking", inputType: "long_text", label: "Anything else", purpose: "Notes" },
      ];
      expect((await vendor.put(`${Q}/draft`, { data: { questions } })).status()).toBe(200);
      const pub = await vendor.post(`${Q}/publish`);
      expect(pub.status()).toBe(200);
      const form = (await pub.json()) as { version: number; questions: { key: string; label: string }[] };
      const k = (label: string) => form.questions.find((q) => q.label === label)!.key;

      results.explore = await measure(() => guest.get("/api/discover"));
      results.search = await measure(() => guest.get("/api/search?q=QA"));
      results.listingDetailWithForm = await measure(() => guest.get(`/api/clubs/${clubId}`));

      const refs: string[] = [];
      const submit: number[] = [];
      const confirm: number[] = [];
      for (let i = 0; i < N; i++) {
        const email = `qa_perf_${randomUUID().slice(0, 8)}@example.test`;
        const clientId = randomUUID();
        const { ms, res } = await timed(() => guest.post("/api/registrations/checkout", {
          headers: { "X-Client-Id": clientId },
          data: { clubId, registrantType: "adult", childFirst: "QA", childLast: `Perf${i}`, gFirst: "QA", gLast: "Perf", email, phone: "000", address: "QA", consent: true, trial: false, acceptedTerms: true,
            questionsVersion: form.version, answers: { booking: { [k("Team name")]: `Team ${i}`, [k("Kit size")]: "M", [k("Level")]: "Some", [k("Photos are fine")]: "yes", [k("Anything else")]: "" } } },
        }));
        submit.push(ms);
        const ref = (await res.json()).ref as string;
        refs.push(ref);
        for (const [t, c] of [["registration_answers", "source_ref"], ["order_acknowledgements", "source_ref"], ["audit_log", "object_id"], ["notifications", "ref"], ["attendance", "ref"]]) f.track(t, c, ref);
        confirm.push((await timed(() => guest.get(`/api/registrations/status/${ref}`, { headers: { "X-Client-Id": clientId } }))).ms);
      }
      results.registrationSubmit = stat(submit);
      results.bookingConfirmation = stat(confirm);
      const [{ n: dupes }] = (await f.connection.query<any[]>("SELECT COUNT(*) - COUNT(DISTINCT ref) AS n FROM registrations WHERE club_id = ?", [clubId]))[0] as { n: number }[];
      expect(Number(dupes)).toBe(0);
      const [{ n: answerRows }] = (await f.connection.query<any[]>(`SELECT COUNT(*) AS n FROM registration_answers WHERE source_type = 'registration' AND source_ref IN (${refs.map(() => "?").join(",")})`, refs))[0] as { n: number }[];
      results.answerRowsPerRegistration = Number(answerRows) / N;

      results.attendeeAnswersList = await measure(() => vendor.get(`/api/vendor/forms/club/${clubId}/answers`));
      const checkin: number[] = [];
      for (const ref of refs) checkin.push((await timed(() => vendor.post(`/api/vendor/checkin/registration/${ref}`, { data: { status: "present" } }))).ms);
      results.doorCheckIn = stat(checkin);
      const today = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      results.reportParticipation = await measure(() => vendor.get(`/api/vendor/reports/participation?from=${from}&to=${today}`));
      results.reportDetailForListing = await measure(() => vendor.get(`/api/vendor/reports/participation/detail?from=${from}&to=${today}&listingType=club&listingId=${clubId}`));
      results.exportReportCsv = await measure(() => vendor.get(`/api/vendor/reports/participation.csv?from=${from}&to=${today}`), 10);
      results.exportAnswersCsv = await measure(() => vendor.get(`/api/vendor/forms/club/${clubId}/answers.csv`), 10);
      const csv = await (await vendor.get(`/api/vendor/forms/club/${clubId}/answers.csv`)).text();
      results.answersCsvRows = csv.trim().split("\n").length - 1;

      results.messagePreview = await measure(() => vendor.post("/api/vendor/messages/preview", { data: { audience: { listingType: "club", listingId: clubId } } }), 10);
      const send = await timed(() => vendor.post("/api/vendor/messages", { data: { audience: { listingType: "club", listingId: clubId }, subject: "QA perf update", body: "Synthetic timing message.", idempotencyKey: `qaperf_${randomUUID().slice(0, 12)}` } }));
      const sent = (await send.res.json()) as { recipientCount: number; delivery: Record<string, unknown>; messageId: number };
      results.messageSend = { ms: Math.round(send.ms), recipients: sent.recipientCount, delivery: sent.delivery };

      // 20 parallel report reads: no errors, wall time.
      const t = performance.now();
      const burst = await Promise.all(Array.from({ length: 20 }, () => vendor.get(`/api/vendor/reports/participation?from=${from}&to=${today}`)));
      results.parallelReports20 = { wallMs: Math.round(performance.now() - t), statuses: [...new Set(burst.map((r) => r.status()))] };
      expect(burst.every((r) => r.status() === 200)).toBe(true);
      results.rssEndMb = backendRssMb();

      mkdirSync(`${process.cwd()}/.qa-data`, { recursive: true });
      writeFileSync(`${process.cwd()}/.qa-data/final-perf.json`, JSON.stringify(results, null, 2));
      console.log(`FINAL-PERF ${JSON.stringify(results)}`);
    } finally {
      await restoreSwitches();
    }
  });
});
