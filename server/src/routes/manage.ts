import crypto from "node:crypto";
import { Router } from "express";
import { GUEST_SESSION_COOKIE, createGuestSession } from "../guestAuth.js";
import { SESSION_COOKIE, createSession, requireVendor } from "../auth.js";
import { db } from "../db/index.js";
import { sendMail } from "../email.js";
import { magicLinkLimiter } from "../rateLimit.js";
import { getResidentByEmail } from "../residents.js";
import { CLIENT_URL } from "../stripe.js";
import { isValidEmail } from "../util.js";
import { writeAudit } from "../audit.js";

// HelloCircle Manage (Phase 1) — links a vendor account to the resident
// (magic-link) account of the same person, and lets an already-authenticated
// session on either side mint the *other* side's session cookie without
// re-entering credentials, once linked. This deliberately does not touch
// attachUser/attachResident/attachGuestEmail (index.ts) at all — a browser
// can already hold both cookies simultaneously; these routes just make sure
// the second one gets set when someone asks to switch into it.

export const manageRouter = Router();

const LINK_TOKEN_MINUTES = 15;

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

// --- Linking (vendor session only — this is the privilege-widening step) ---

/** Step 1: an approved vendor asks to link a resident account by email. Sends
 * a confirmation link to that inbox rather than trusting "I know the email" —
 * same no-existence-leak shape as every other emailed-link route, except this
 * one DOES need to reveal whether a resident account exists (there is
 * nothing to link to otherwise), so it returns that explicitly instead of
 * always saying "ok" — a vendor is already an authenticated party here, not
 * an anonymous caller, so this isn't the same leak surface as e.g. the
 * password-reset routes. */
manageRouter.post("/link/request", requireVendor, magicLinkLimiter, async (req, res) => {
  const { residentEmail } = req.body as { residentEmail?: string };
  if (!residentEmail || !isValidEmail(residentEmail)) return res.status(400).json({ error: "A valid email is required" });
  const normalized = residentEmail.toLowerCase().trim();

  const resident = await getResidentByEmail(normalized);
  if (!resident) return res.status(404).json({ error: "No HelloCircle account found for that email — sign in there first, then link it here." });

  const existingLink = (await db.prepare(`SELECT id FROM users WHERE resident_id = ?`).get(resident.id)) as { id: string } | undefined;
  if (existingLink && existingLink.id !== req.user!.id) {
    return res.status(409).json({ error: "That account is already linked to a different vendor login." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  await db
    .prepare(`INSERT INTO manage_link_tokens (token, user_id, resident_email, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ${LINK_TOKEN_MINUTES} MINUTE))`)
    .run(token, req.user!.id, normalized);
  await sendMail({
    to: normalized,
    subject: "Link your HelloCircle accounts",
    text: `Hi,\n\n${req.user!.businessName || "A HelloCircle vendor account"} wants to link this HelloCircle account so you can switch between them without signing in twice.\n\nConfirm the link:\n${CLIENT_URL}/manage/link-confirm?token=${token}\n\nThis link expires in 15 minutes. If you didn't request this, you can safely ignore it — nothing is linked until you click the link above.\n\nThanks for using HelloCircle.`,
  });
  res.json({ ok: true });
});

/** Step 2: the resident confirms by visiting the emailed link while signed in
 * (or not — the token alone is proof of inbox access, same trust level as
 * every other magic-link token in this codebase) — sets users.resident_id. */
manageRouter.post("/link/confirm", async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: "Token is required" });

  const row = (await db.prepare(`SELECT user_id, resident_email FROM manage_link_tokens WHERE token = ? AND expires_at > NOW()`).get(token)) as
    | { user_id: string; resident_email: string }
    | undefined;
  if (!row) return res.status(400).json({ error: "This link has expired or was already used — request a new one from your vendor dashboard." });
  await db.prepare(`DELETE FROM manage_link_tokens WHERE token = ?`).run(token);

  const resident = await getResidentByEmail(row.resident_email);
  if (!resident) return res.status(404).json({ error: "That HelloCircle account no longer exists." });

  await db.prepare(`UPDATE users SET resident_id = ? WHERE id = ?`).run(resident.id, row.user_id);
  await writeAudit({ actorUserId: row.user_id, action: "manage.linked_resident", objectType: "user", objectId: row.user_id, newValue: { residentId: resident.id } });
  res.json({ ok: true });
});

// --- Workspaces + switching (either session) --------------------------------

manageRouter.get("/workspaces", async (req, res) => {
  const workspaces: {
    personal: boolean;
    vendor: { businessName: string; orgId: string | null } | null;
    circlesOrganising: { id: string; slug: string | null; name: string }[];
  } = { personal: !!req.resident, vendor: null, circlesOrganising: [] };

  // Vendor capability: either this request already IS the vendor session, or
  // the signed-in resident has a linked vendor account.
  if (req.user && req.user.role === "vendor") {
    workspaces.vendor = { businessName: req.user.businessName, orgId: req.user.orgId };
  } else if (req.resident) {
    const linked = (await db.prepare(`SELECT business_name, org_id FROM users WHERE resident_id = ? AND role = 'vendor'`).get(req.resident.id)) as
      | { business_name: string; org_id: string | null }
      | undefined;
    if (linked) workspaces.vendor = { businessName: linked.business_name, orgId: linked.org_id };
  }

  if (req.resident) {
    workspaces.circlesOrganising = (await db
      .prepare(
        `SELECT c.id, c.slug, c.name FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
         WHERE cm.resident_id = ? AND cm.role = 'organiser' AND c.status != 'closed'
         ORDER BY c.name`
      )
      .all(req.resident.id)) as { id: string; slug: string | null; name: string }[];
  }

  res.json(workspaces);
});

/** Mints the *other* side's session cookie for an already-linked account —
 * never checks a password, because the link itself (above) was the one
 * privilege-widening step that required real confirmation. */
manageRouter.post("/switch", async (req, res) => {
  const { to } = req.body as { to?: "vendor" | "resident" };

  if (to === "vendor") {
    if (!req.resident) return res.status(401).json({ error: "Sign in required" });
    const linked = (await db.prepare(`SELECT id FROM users WHERE resident_id = ? AND role = 'vendor'`).get(req.resident.id)) as { id: string } | undefined;
    if (!linked) return res.status(404).json({ error: "No linked vendor account" });
    const { token } = await createSession(linked.id);
    res.cookie(SESSION_COOKIE, token, cookieOpts);
    await writeAudit({ actorUserId: linked.id, action: "manage.switched_workspace", objectType: "user", objectId: linked.id, newValue: { to: "vendor" } });
    return res.json({ ok: true });
  }

  if (to === "resident") {
    if (!req.user || !req.user.residentId) return res.status(404).json({ error: "No linked resident account" });
    const resident = (await db.prepare(`SELECT email FROM residents WHERE id = ?`).get(req.user.residentId)) as { email: string } | undefined;
    if (!resident) return res.status(404).json({ error: "No linked resident account" });
    const { token } = await createGuestSession(resident.email);
    res.cookie(GUEST_SESSION_COOKIE, token, cookieOpts);
    await writeAudit({ actorUserId: req.user.id, action: "manage.switched_workspace", objectType: "user", objectId: req.user.id, newValue: { to: "resident" } });
    return res.json({ ok: true });
  }

  res.status(400).json({ error: `"to" must be "vendor" or "resident"` });
});
