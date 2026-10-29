import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { requirePlatformRole } from "../auth.js";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { deliverMail } from "../email.js";
import {
  MESSAGE_TEMPLATES,
  createMessage,
  deliverySummary,
  dispatchMessage,
  isTemplateKey,
  ownedListing,
  previewOf,
  render,
  resolveAudience,
  type AudienceFilter,
  type AudienceSpec,
  type TemplateKey,
} from "../participation/partnerMessages.js";
import { inClause } from "./vendorHelpers.js";

// Phase K (docs/participation-expansion/22) — the partner Messages screen's
// API. Same paths and role as before (sending needs the communications role;
// owners always can); now any listing type, an audience (session/date and
// attendance or answers), approved templates, a preview without addresses,
// a "send me a test" that only ever reaches the sender, idempotent sends,
// delivery status and history. The audience is always resolved here from the
// organisation's own listing — a client can't name recipients.

export const vendorMessagesRouter = Router();

const LISTING_TYPES = ["centre", "club", "program", "experience"] as const;
const FILTERS: AudienceFilter[] = ["all", "checked_in", "not_checked_in", "waiting_answers"];

function specFrom(raw: unknown): AudienceSpec | null {
  const b = (raw ?? {}) as Record<string, unknown>;
  if (!LISTING_TYPES.includes(b.listingType as (typeof LISTING_TYPES)[number]) || typeof b.listingId !== "string" || !b.listingId) return null;
  const filter = FILTERS.includes(b.filter as AudienceFilter) ? (b.filter as AudienceFilter) : "all";
  const sessionId = typeof b.sessionId === "string" && b.sessionId ? b.sessionId : null;
  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
  return { listingType: b.listingType as AudienceSpec["listingType"], listingId: b.listingId, sessionId, date, filter };
}

async function audienceFor(req: Request, res: Response): Promise<{ spec: AudienceSpec; title: string; vendorId: string } | null> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Older clients send { listingType, listingId } at the top level.
  const spec = specFrom(body.audience ?? body);
  if (!spec) {
    res.status(400).json({ error: "Choose a listing" });
    return null;
  }
  const listing = await ownedListing(req.vendorIds!, spec);
  if (!listing) {
    res.status(403).json({ error: "Not your listing" });
    return null;
  }
  return { spec, title: listing.title, vendorId: listing.vendorId };
}

function textFrom(body: Record<string, unknown>): { subject: string; message: string; templateKey: TemplateKey } | { error: string } {
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.body === "string" ? body.body.trim() : "";
  if (!subject || !message) return { error: "Write a subject and a message" };
  if (subject.length > 200) return { error: "Keep the subject under 200 characters" };
  if (message.length > 5000) return { error: "Keep the message under 5,000 characters" };
  if (/\[(Write your update here|New time or date|Address, entrance|List|Anything)/.test(message)) return { error: "Replace the [bracketed] parts of the template before sending" };
  return { subject, message, templateKey: isTemplateKey(body.templateKey) ? body.templateKey : "custom" };
}

vendorMessagesRouter.get("/messages/templates", (_req, res) => {
  res.json({ templates: MESSAGE_TEMPLATES });
});

/** Who would get it: counts and first names only. */
vendorMessagesRouter.post("/messages/preview", requirePlatformRole("communications"), async (req, res) => {
  const a = await audienceFor(req, res);
  if (!a) return;
  res.json(previewOf(await resolveAudience(a.spec)));
});

/** The rendered message to the sender's own address only — never to participants. */
vendorMessagesRouter.post("/messages/test", requirePlatformRole("communications"), async (req, res) => {
  const a = await audienceFor(req, res);
  if (!a) return;
  const t = textFrom(req.body ?? {});
  if ("error" in t) return res.status(400).json({ error: t.error });
  const me = (await db.prepare(`SELECT email, name FROM users WHERE id = ?`).get(req.user!.id)) as { email: string; name: string } | undefined;
  if (!me?.email) return res.status(400).json({ error: "Your account has no email address" });
  const vars = { name: (me.name || "").split(" ")[0], listing: a.title, when: "" };
  const outcome = await deliverMail({ to: me.email, subject: `[Test] ${render(t.subject, vars)}`, text: `${render(t.message, vars)}\n\n—\nThis is a test sent only to you. Nobody else received it.` });
  res.json({ sent: outcome, to: me.email.replace(/^(.).*(@.*)$/, "$1…$2") });
});

vendorMessagesRouter.post("/messages", requirePlatformRole("communications"), async (req, res) => {
  const a = await audienceFor(req, res);
  if (!a) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const t = textFrom(body);
  if ("error" in t) return res.status(400).json({ error: t.error });
  const idem = typeof body.idempotencyKey === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(body.idempotencyKey) ? body.idempotencyKey : crypto.randomUUID();
  const recipients = await resolveAudience(a.spec);
  // Nobody matching is still recorded (as before Phase K); the preview shows the count before sending.
  const created = await createMessage({ senderId: req.user!.id, vendorId: a.vendorId, orgId: req.user!.orgId ?? null, spec: a.spec, templateKey: t.templateKey, subject: t.subject, body: t.message, idempotencyKey: idem, recipients });
  if (!created.duplicate) {
    // Who, which listing and how many — never the recipients or the text.
    await writeAudit({ actorUserId: req.user!.id, action: "vendor_message.sent", objectType: a.spec.listingType, objectId: a.spec.listingId, newValue: { messageId: created.messageId, recipients: recipients.length, template: t.templateKey, filter: a.spec.filter } });
    await dispatchMessage(created.messageId);
  }
  const summary = (await deliverySummary([created.messageId])).get(created.messageId) ?? {};
  res.status(created.duplicate ? 200 : 201).json({ ok: true, messageId: created.messageId, duplicate: created.duplicate, recipientCount: recipients.length, delivery: summary });
});

/** The organisation's sent messages, with delivery status per channel. */
vendorMessagesRouter.get("/messages", async (req, res) => {
  const ids = req.vendorIds!;
  const rows = (await db
    .prepare(
      `SELECT id, listing_type as listingType, listing_id as listingId, subject, body, template_key AS templateKey, recipient_count AS recipientCount, audience_json AS audience, created_at as createdAt
       FROM vendor_messages WHERE vendor_id IN (${inClause(ids)}) ORDER BY created_at DESC, id DESC LIMIT 200`
    )
    .all(...ids)) as { id: number; audience: string | null; recipientCount: number }[];
  const summary = await deliverySummary(rows.map((r) => Number(r.id)));
  res.json(
    rows.map((r) => {
      let audience: unknown = null;
      try {
        audience = r.audience ? JSON.parse(r.audience) : null;
      } catch {
        audience = null;
      }
      return { ...r, recipientCount: Number(r.recipientCount ?? 0), audience, delivery: summary.get(Number(r.id)) ?? {} };
    })
  );
});
