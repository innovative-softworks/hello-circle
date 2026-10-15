import { db } from "./db/index.js";
import { sendMail } from "./email.js";
import { notifyResident } from "./notifications.js";
import { CLIENT_URL } from "./stripe.js";
import type { DecisionReason, ReasonKind } from "./moderationDecisions.js";
import { categoryLabel } from "./moderationDecisions.js";

// D-03 — tells the affected partner or applicant about a decision, through
// the existing channels: the in-app notifications table (partners: by
// recipient_id; residents: notifyResident) and sendMail (no SMTP in QA — the
// harness's mail observer records recipient and subject only). Only the
// partner-visible explanation is ever sent; the internal note never is.
// Never throws: a notification failure doesn't undo the decision.

const SUPPORT = `${CLIENT_URL}/contact`;
const COMPLAINTS = `${CLIENT_URL}/complaints`;

function reasonLines(kind: ReasonKind, reason: DecisionReason | null): string {
  if (!reason?.explanation) return "";
  return `Reason: ${categoryLabel(kind, reason.category)}\n${reason.explanation}\n\n`;
}

export async function notifyPartner(
  vendorId: string | null,
  msg: { title: string; intro: string; kind: ReasonKind; reason: DecisionReason | null; nextSteps: string; listingType?: string | null; listingId?: string | null; ref?: string | null }
) {
  if (!vendorId) return;
  let vendor: { email: string; name: string } | undefined;
  try {
    vendor = (await db.prepare(`SELECT email, name FROM users WHERE id = ?`).get(vendorId)) as { email: string; name: string } | undefined;
  } catch (e) {
    console.error("[moderation] partner lookup failed:", e instanceof Error ? e.message : e);
    return;
  }
  if (!vendor) return;
  const body = `${msg.intro}\n\n${reasonLines(msg.kind, msg.reason)}${msg.nextSteps}`;
  // The workspace notice and the email are independent: one failing never
  // stops the other. listing_type/listing_id/ref are NOT NULL columns, so an
  // account-level notice (suspension, reinstatement) is filed as "account".
  try {
    await db
      .prepare(`INSERT INTO notifications (recipient_id, kind, title, body, listing_type, listing_id, ref) VALUES (?, 'moderation', ?, ?, ?, ?, ?)`)
      .run(vendorId, msg.title, body.slice(0, 2000), msg.listingType ?? "account", msg.listingId ?? vendorId, msg.ref ?? "");
  } catch (e) {
    console.error("[moderation] partner notification failed:", e instanceof Error ? e.message : e);
  }
  try {
    await sendMail({ to: vendor.email, subject: msg.title, text: `Hi ${vendor.name || "there"},\n\n${body}\n\nHelloCircle` });
  } catch (e) {
    console.error("[moderation] partner email failed:", e instanceof Error ? e.message : e);
  }
}

export async function notifyApplicant(
  residentId: string | null,
  msg: { title: string; intro: string; kind: ReasonKind; reason: DecisionReason | null; nextSteps: string; email?: boolean; suggestionId?: string }
) {
  if (!residentId) return;
  try {
    const body = `${msg.intro}\n\n${reasonLines(msg.kind, msg.reason)}${msg.nextSteps}`;
    await notifyResident({ residentId, kind: "moderation", title: msg.title, body: body.slice(0, 2000), listingType: msg.suggestionId ? "place_suggestion" : "host", listingId: msg.suggestionId ?? residentId, ref: "" });
    if (msg.email !== false) {
      const r = (await db.prepare(`SELECT email, name FROM residents WHERE id = ?`).get(residentId)) as { email: string; name: string } | undefined;
      if (r?.email) await sendMail({ to: r.email, subject: msg.title, text: `Hi ${r.name || "there"},\n\n${body}\n\nHelloCircle` });
    }
  } catch (e) {
    console.error("[moderation] applicant notification failed:", e instanceof Error ? e.message : e);
  }
}

export const NEXT_STEPS = {
  listing: `What you can do: edit the listing in your Partner workspace and resubmit it for review. Questions: ${SUPPORT}. To ask for the decision to be looked at again, use ${COMPLAINTS}.`,
  suspension: `Contact HelloCircle at ${SUPPORT}. To ask for the decision to be looked at again, use ${COMPLAINTS}.`,
  claim: `You can submit a new claim with more detail, or contact HelloCircle at ${SUPPORT}.`,
  host: `You can keep hosting activities and Circles as before; this only concerns the Verified Host badge. You're welcome to apply again. Questions: ${SUPPORT}.`,
  suggestion: `Thanks for the suggestion. Questions: ${SUPPORT}.`,
};
