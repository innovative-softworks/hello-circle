import { writeAudit } from "./audit.js";
import { db } from "./db/index.js";
import { sendMail } from "./email.js";
import { notifyResident } from "./notifications.js";
import { CLIENT_URL } from "./stripe.js";

// OG-05 / OG-15 — money exceptions, in one place, read from the records that
// already hold them. Nothing here moves money or retries anything: each item
// links to the existing Finance page (or partner page) where the approved
// action lives. Partners are told once when one of their payouts fails or
// their Pro payment fails.

export type Severity = "high" | "medium";

export interface OperationalException {
  id: string;
  kind: "payment_review" | "dispute" | "refund_pending" | "refund_stuck" | "webhook_failed" | "payout_failed" | "subscription_past_due" | "partner_debt";
  severity: Severity;
  team: "Finance";
  title: string;
  detail: string;
  status: string;
  amountMinor: number | null;
  createdAt: string;
  party: { type: string; id: string; name: string | null } | null;
  /** Where the admin resolves it (admin URL query). */
  link: string;
}

const eur = (minor: number | string | null) => (minor === null ? "" : `€${(Number(minor) / 100).toFixed(2)}`);

type Party = { type: string; id: string };
async function partyName(p: Party): Promise<string | null> {
  if (p.type === "org") return ((await db.prepare(`SELECT name FROM organisations WHERE id = ?`).get(p.id)) as { name: string } | undefined)?.name ?? null;
  if (p.type === "vendor") return ((await db.prepare(`SELECT COALESCE(NULLIF(business_name, ''), name) as name FROM users WHERE id = ?`).get(p.id)) as { name: string } | undefined)?.name ?? null;
  if (p.type === "host") return ((await db.prepare(`SELECT name FROM residents WHERE id = ?`).get(p.id)) as { name: string } | undefined)?.name ?? null;
  return null;
}

export async function listFinancialExceptions(): Promise<OperationalException[]> {
  const out: OperationalException[] = [];

  const reviews = (await db
    .prepare(`SELECT id, source_type as st, source_ref as sr, reason, hold_status as hold, review_hold_until as holdUntil, flagged_at as at FROM payment_reviews WHERE status = 'open' ORDER BY flagged_at`)
    .all()) as { id: number; st: string | null; sr: string | null; reason: string; hold: string; holdUntil: string | null; at: string }[];
  for (const r of reviews) {
    out.push({
      id: `payment_review:${r.id}`, kind: "payment_review", severity: "high", team: "Finance",
      title: `Payment under review${r.sr ? ` · ${r.st} ${r.sr}` : ""}`,
      detail: `Reason: ${r.reason.replace(/_/g, " ")}${r.hold === "held" && r.holdUntil ? ` · place held until ${new Date(r.holdUntil).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}`,
      status: "open", amountMinor: null, createdAt: r.at, party: null, link: `?tab=finance&section=reviews&record=review:${r.id}`,
    });
  }

  const disputes = (await db
    .prepare(`SELECT id, source_type as st, source_ref as sr, amount_minor as amount, reason, status, evidence_due_by as due, created_at as at FROM disputes WHERE status NOT IN ('won', 'lost', 'charge_refunded', 'warning_closed') ORDER BY created_at`)
    .all()) as { id: number; st: string | null; sr: string | null; amount: number; reason: string; status: string; due: string | null; at: string }[];
  for (const d of disputes) {
    out.push({
      id: `dispute:${d.id}`, kind: "dispute", severity: "high", team: "Finance",
      title: `Card dispute ${eur(d.amount)}${d.sr ? ` · ${d.st} ${d.sr}` : ""}`,
      detail: `${d.reason.replace(/_/g, " ")}${d.due ? ` · evidence due ${new Date(d.due).toISOString().slice(0, 10)}` : ""}`,
      status: d.status, amountMinor: Number(d.amount), createdAt: d.at, party: null, link: `?tab=finance&section=disputes&record=dispute:${d.id}`,
    });
  }

  // A cancelled order still marked paid online: its automatic refund didn't go through.
  const pending = (await db
    .prepare(
      `SELECT * FROM (
         SELECT 'booking' as type, ref, total_cents as amount, created_at as at FROM bookings WHERE status = 'cancelled' AND payment_status = 'paid' AND stripe_session_id IS NOT NULL AND total_cents > 0
         UNION ALL SELECT 'registration', ref, total_cents, created_at FROM registrations WHERE status = 'cancelled' AND payment_status = 'paid' AND stripe_session_id IS NOT NULL AND total_cents > 0
         UNION ALL SELECT 'program', ref, total_cents, created_at FROM program_enrollments WHERE status = 'cancelled' AND payment_status = 'paid' AND stripe_session_id IS NOT NULL AND total_cents > 0
         UNION ALL SELECT 'experience', ref, total_cents, created_at FROM experience_bookings WHERE status = 'cancelled' AND payment_status = 'paid' AND stripe_session_id IS NOT NULL AND total_cents > 0
       ) o ORDER BY at LIMIT 200`
    )
    .all()) as { type: string; ref: string; amount: number; at: string }[];
  for (const p of pending) {
    out.push({
      id: `refund_pending:${p.type}:${p.ref}`, kind: "refund_pending", severity: "high", team: "Finance",
      title: `Refund due · ${p.type} ${p.ref}`,
      detail: `Cancelled, but the ${eur(p.amount)} online payment hasn't been refunded yet`,
      status: "refund pending", amountMinor: Number(p.amount), createdAt: p.at, party: null, link: `?tab=finance&section=refunds&record=order:${p.type}:${p.ref}`,
    });
  }

  const stuck = (await db
    .prepare(`SELECT id, source_type as st, source_ref as sr, amount_minor as amount, created_at as at FROM refunds WHERE status = 'pending' AND created_at < NOW() - INTERVAL 1 HOUR ORDER BY created_at LIMIT 100`)
    .all()) as { id: number; st: string; sr: string; amount: number; at: string }[];
  for (const r of stuck) {
    out.push({
      id: `refund_stuck:${r.id}`, kind: "refund_stuck", severity: "medium", team: "Finance",
      title: `Refund not confirmed · ${r.st} ${r.sr}`, detail: `${eur(r.amount)} started over an hour ago and the provider hasn't confirmed it`,
      status: "pending", amountMinor: Number(r.amount), createdAt: r.at, party: null, link: `?tab=finance&section=refunds&record=refund:${r.id}`,
    });
  }

  const events = (await db.prepare(`SELECT id, event_type as type, last_error as err, received_at as at FROM webhook_events WHERE status = 'failed' ORDER BY received_at LIMIT 100`).all().catch(() => [])) as {
    id: string | number; type: string; err: string | null; at: string;
  }[];
  for (const e of events) {
    out.push({
      id: `webhook_failed:${e.id}`, kind: "webhook_failed", severity: "medium", team: "Finance",
      title: `Payment event failed · ${e.type}`, detail: e.err ?? "Processing failed", status: "failed", amountMinor: null, createdAt: e.at, party: null,
      link: `?tab=finance&section=events&record=event:${e.id}`,
    });
  }

  const payouts = (await db
    .prepare(
      `SELECT p.provider_payout_id as id, p.amount_minor as amount, p.status, p.failure_message as message, p.updated_at as at, a.party_type as pt, a.party_id as pid
       FROM connected_payouts p JOIN connected_accounts a ON a.account_id = p.account_id
       WHERE p.status IN ('failed', 'canceled') AND p.updated_at > NOW() - INTERVAL 90 DAY ORDER BY p.updated_at`
    )
    .all()) as { id: string; amount: number; status: string; message: string | null; at: string; pt: string; pid: string }[];
  for (const p of payouts) {
    out.push({
      id: `payout_failed:${p.id}`, kind: "payout_failed", severity: "high", team: "Finance",
      title: `Bank payout ${p.status} · ${eur(p.amount)}`, detail: p.message ?? "The bank payout didn't go through",
      status: p.status, amountMinor: Number(p.amount), createdAt: p.at, party: { type: p.pt, id: p.pid, name: await partyName({ type: p.pt, id: p.pid }) },
      link: `?tab=finance&section=payouts`,
    });
  }

  const subs = (await db
    .prepare(`SELECT id, party_type as pt, party_id as pid, gross_minor as amount, grace_until as grace, updated_at as at FROM partner_subscriptions WHERE status = 'past_due' ORDER BY updated_at`)
    .all()) as { id: number; pt: string; pid: string; amount: number; grace: string | null; at: string }[];
  for (const s of subs) {
    out.push({
      id: `subscription_past_due:${s.id}`, kind: "subscription_past_due", severity: "medium", team: "Finance",
      title: `Pro payment failed · ${eur(s.amount)}`, detail: s.grace ? `Pro continues until ${new Date(s.grace).toISOString().slice(0, 10)} unless the payment succeeds` : "Pro payment failed",
      status: "past due", amountMinor: Number(s.amount), createdAt: s.at, party: { type: s.pt, id: s.pid, name: await partyName({ type: s.pt, id: s.pid }) },
      link: `?tab=plansCredit&section=credits`,
    });
  }

  const debts = (await db
    .prepare(`SELECT id, party_type as pt, party_id as pid, opened_minor - recovered_minor - offset_minor as owed, reason, opened_at as at FROM partner_debts WHERE status = 'open' ORDER BY opened_at`)
    .all()) as { id: number; pt: string; pid: string; owed: number; reason: string; at: string }[];
  for (const d of debts) {
    out.push({
      id: `partner_debt:${d.id}`, kind: "partner_debt", severity: "medium", team: "Finance",
      title: `Partner owes ${eur(d.owed)}`, detail: d.reason, status: "open", amountMinor: Number(d.owed), createdAt: d.at,
      party: { type: d.pt, id: d.pid, name: await partyName({ type: d.pt, id: d.pid }) }, link: `?tab=finance&section=debts`,
    });
  }

  const rank = (s: Severity) => (s === "high" ? 0 : 1);
  return out.sort((a, b) => rank(a.severity) - rank(b.severity) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

// --- partner notices ---------------------------------------------------------

/** Tells a partner (organisation owner + finance staff, or the host) about a money problem. Never throws. */
async function tellParty(party: Party, msg: { title: string; body: string; path: string }) {
  try {
    if (party.type === "host") {
      await notifyResident({ residentId: party.id, kind: "payment", title: msg.title, body: msg.body.slice(0, 2000), listingType: "account", listingId: party.id, ref: "" });
      const r = (await db.prepare(`SELECT email, name FROM residents WHERE id = ?`).get(party.id)) as { email: string; name: string } | undefined;
      if (r?.email) await sendMail({ to: r.email, subject: msg.title, text: `Hi ${r.name || "there"},\n\n${msg.body}\n\n${CLIENT_URL}${msg.path}\n\nHelloCircle` });
      return;
    }
    const recipients = (await db
      .prepare(
        party.type === "org"
          ? `SELECT id, email, name FROM users WHERE org_id = ? AND role = 'vendor' AND status = 'approved' AND (invited_staff = 0 OR platform_role = 'finance')`
          : `SELECT id, email, name FROM users WHERE id = ? AND role = 'vendor'`
      )
      .all(party.id)) as { id: string; email: string; name: string }[];
    for (const u of recipients) {
      await db
        .prepare(`INSERT INTO notifications (recipient_id, kind, title, body, listing_type, listing_id, ref) VALUES (?, 'payment', ?, ?, 'account', ?, '')`)
        .run(u.id, msg.title, msg.body.slice(0, 2000), u.id);
      await sendMail({ to: u.email, subject: msg.title, text: `Hi ${u.name || "there"},\n\n${msg.body}\n\n${CLIENT_URL}${msg.path}\n\nHelloCircle` });
    }
  } catch (e) {
    console.error("[finance] partner notice failed:", e instanceof Error ? e.message : e);
  }
}

const partyOfAccount = async (accountId: string) =>
  (await db.prepare(`SELECT party_type as type, party_id as id FROM connected_accounts WHERE account_id = ?`).get(accountId)) as Party | undefined;

/** After a payout event: a failed or cancelled bank payout is announced once. */
export async function noticeFailedPayout(providerPayoutId: string) {
  const p = (await db.prepare(`SELECT account_id as accountId, amount_minor as amount, status, failure_message as message FROM connected_payouts WHERE provider_payout_id = ?`).get(providerPayoutId)) as
    | { accountId: string; amount: number; status: string; message: string | null }
    | undefined;
  if (!p || (p.status !== "failed" && p.status !== "canceled")) return;
  const claimed = await db.prepare(`UPDATE connected_payouts SET failure_notified_at = NOW() WHERE provider_payout_id = ? AND failure_notified_at IS NULL`).run(providerPayoutId);
  if (claimed.changes !== 1) return;
  const party = await partyOfAccount(p.accountId);
  if (!party) return;
  await tellParty(party, {
    title: `A bank payout of ${eur(p.amount)} didn't go through`,
    body: `Stripe couldn't pay ${eur(p.amount)} into your bank account${p.message ? `: ${p.message}` : ""}. The money stays in your Stripe balance. Check your bank details in your Stripe account (Earnings → Payouts → Open Stripe); Stripe tries again once they're fixed.`,
    path: party.type === "host" ? "/manage?tab=earnings" : "/vendor?tab=earnings&view=payouts",
  });
  await writeAudit({ actorUserId: null, actorKind: "system", action: "payout.failure_notified", objectType: "connected_payout", objectId: providerPayoutId, newValue: { status: p.status } });
}

/** After a subscription update: the first failed Pro payment is announced once. */
export async function noticePastDue(subscriptionRowId: number) {
  const s = (await db.prepare(`SELECT party_type as pt, party_id as pid, status, grace_until as grace, gross_minor as amount FROM partner_subscriptions WHERE id = ?`).get(subscriptionRowId)) as
    | { pt: string; pid: string; status: string; grace: string | null; amount: number }
    | undefined;
  if (!s || s.status !== "past_due") return;
  const claimed = await db.prepare(`UPDATE partner_subscriptions SET past_due_notified_at = NOW() WHERE id = ? AND past_due_notified_at IS NULL`).run(subscriptionRowId);
  if (claimed.changes !== 1) return;
  const until = s.grace ? new Date(s.grace).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", dateStyle: "long" }) : null;
  await tellParty(
    { type: s.pt, id: s.pid },
    {
      title: "Your HelloCircle Pro payment failed",
      body: `We couldn't take your Pro payment of ${eur(s.amount)}. Pro stays on${until ? ` until ${until}` : " for now"}; update your card in the billing portal (Earnings → Plan & billing) to keep it. If the payment isn't made by then, your plan goes back to Free.`,
      path: s.pt === "host" ? "/manage?tab=earnings" : "/vendor?tab=earnings",
    }
  );
  await writeAudit({ actorUserId: null, actorKind: "system", action: "subscription.past_due_notified", objectType: `partner_${s.pt}`, objectId: s.pid });
}
