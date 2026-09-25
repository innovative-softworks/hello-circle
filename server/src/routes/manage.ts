import crypto from "node:crypto";
import { Router } from "express";
import { GUEST_SESSION_COOKIE, createGuestSession } from "../guestAuth.js";
import { SESSION_COOKIE, createSession, createUser, findUserByEmail, requireVendor } from "../auth.js";
import { db } from "../db/index.js";
import { sendMail } from "../email.js";
import { magicLinkLimiter } from "../rateLimit.js";
import { getResidentByEmail, requireResident } from "../residents.js";
import { CLIENT_URL } from "../stripe.js";
import { isValidEmail } from "../util.js";
import { writeAudit } from "../audit.js";
import { TERMS_VERSION } from "../terms.js";

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
  const confirmUrl = `${CLIENT_URL}/manage/link-confirm?token=${token}`;
  await sendMail({
    to: normalized,
    subject: "Link your HelloCircle accounts",
    text: `Hi,\n\n${req.user!.businessName || "A HelloCircle vendor account"} wants to link this HelloCircle account so you can switch between them without signing in twice.\n\nConfirm the link:\n${confirmUrl}\n\nThis link expires in 15 minutes. If you didn't request this, you can safely ignore it — nothing is linked until you click the link above.\n\nThanks for using HelloCircle.`,
    cta: { label: "Confirm the link", url: confirmUrl },
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

// --- Becoming a provider (resident session only) ----------------------------

/** The inverse of the link flow above: a *verified Host* creates the vendor
 * account they don't have yet, linked to the resident they already are. Until
 * this existed, host_status was effectively badge-only — a verified Host could
 * be followed and reviewed, but had no route into /vendor/* at all, and the
 * only bridge (link/request, above) ran vendor -> resident, so there was no
 * way in from this side.
 *
 * No emailed confirmation step here, unlike link/request: that step exists
 * because a vendor asserting "I know this resident's email" hasn't proven they
 * own that inbox. Here the caller *is* the resident session, which a magic
 * link already proved. Re-mailing them would confirm nothing new.
 *
 * Everything after this route is already built — /manage/workspaces reports
 * the linked vendor from a resident session, and /manage/switch mints the
 * vendor cookie — so creating the row is the whole of the missing piece. */
// Onboarding audit (consent pass) — a resident becoming a provider creates a
// brand-new `users` row (a new legal capacity — a business account that will
// eventually take payments), the same moment POST /auth/signup's direct
// vendor path already requires Terms acceptance for. The resident's own
// prior acceptance on their `residents` row doesn't carry over automatically
// — that would be inferring one account's consent onto a different account
// it was never given for. termsAccepted is required here too now, same
// wording/shape as every other vendor-signup surface.
manageRouter.post("/become-provider", requireResident, async (req, res) => {
  const { password, vendorType, businessName, address, county, mobile, landline, description, termsAccepted, marketingConsent } = req.body as {
    password?: string;
    vendorType?: string;
    businessName?: string;
    address?: string;
    county?: string;
    mobile?: string;
    landline?: string;
    description?: string;
    termsAccepted?: boolean;
    marketingConsent?: boolean;
  };

  const resident = (await db.prepare(`SELECT id, email, name, host_status as hostStatus FROM residents WHERE id = ?`).get(req.resident!.id)) as
    | { id: string; email: string; name: string; hostStatus: string }
    | undefined;
  if (!resident) return res.status(404).json({ error: "Account not found" });
  if (resident.hostStatus !== "verified") {
    return res.status(403).json({ error: "Only verified Hosts can open a provider account — apply for Host verification first." });
  }

  if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!vendorType || !["community", "sports"].includes(vendorType)) {
    return res.status(400).json({ error: "Please choose whether you run a community centre or a sports club" });
  }
  if (!businessName || !address || !county || !mobile || !description) {
    return res.status(400).json({ error: "Business name, address, county, mobile number and description are required" });
  }
  if (!termsAccepted) return res.status(400).json({ error: "Please accept the Terms to continue" });

  const existingLink = (await db.prepare(`SELECT id FROM users WHERE resident_id = ?`).get(resident.id)) as { id: string } | undefined;
  if (existingLink) return res.status(409).json({ error: "This account already has a provider login — switch into it instead." });
  // The vendor side logs in by email/password (/auth/login), so the resident's
  // own email has to be free on `users` for that login to be reachable.
  if (await findUserByEmail(resident.email)) {
    return res.status(409).json({ error: "A provider account with your email already exists — sign in to it and link this account from there." });
  }

  // Mirrors /auth/signup's transaction exactly (org + user + draft listing),
  // with the resident link set in the same commit. Status stays 'pending':
  // host verification vets a *person* to run community activity, while vendor
  // approval vets a *business* that will take payments — passing the first
  // shouldn't silently skip the second.
  const user = await db.transaction(async (tx) => {
    const orgId = crypto.randomUUID();
    await tx.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, ?, 'vendor')`).run(orgId, businessName);

    const user = await createUser(
      resident.email,
      password,
      resident.name,
      "vendor",
      "pending",
      {
        vendorType: vendorType as "community" | "sports",
        businessName,
        address,
        county,
        mobile,
        landline: landline ?? "",
        description,
      },
      tx,
      { orgId }
    );
    // createUser() builds its return value before this UPDATE, so the link has
    // to be reflected back onto it or the response reports residentId: null.
    await tx.prepare(`UPDATE users SET resident_id = ?, terms_accepted_at = NOW(), terms_version = ?, marketing_consent = ? WHERE id = ?`).run(resident.id, TERMS_VERSION, marketingConsent ? 1 : 0, user.id);
    user.residentId = resident.id;

    const listingId = crypto.randomUUID();
    if (vendorType === "community") {
      await tx.prepare(
        `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, '', ?, ?, 'pending', NOW())`
      ).run(listingId, businessName, address, county, businessName, mobile, description, user.id);
      await tx.prepare(
        `INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order) VALUES (?, ?, 'Main Room', 0, 0, '', 0)`
      ).run(crypto.randomUUID(), listingId);
    } else {
      await tx.prepare(
        `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, created_at)
         VALUES (?, ?, '', ?, ?, '', 0, 'year', 0, ?, '', ?, ?, 'pending', NOW())`
      ).run(listingId, businessName, address, county, mobile, description, user.id);
    }
    return user;
  });

  await writeAudit({
    actorUserId: user.id,
    action: "manage.host_became_provider",
    objectType: "user",
    objectId: user.id,
    newValue: { residentId: resident.id, vendorType, businessName },
  });

  res.status(201).json({ user });
});

// --- Workspaces + switching (either session) --------------------------------

manageRouter.get("/workspaces", async (req, res) => {
  const workspaces: {
    personal: boolean;
    // `status` is here because a Host who just opened a provider account via
    // /become-provider is 'pending' until admin approves — switching into it
    // works, but every requireVendor route 403s, so the client needs to show
    // "awaiting approval" rather than offer a dashboard that can't load.
    vendor: { businessName: string; orgId: string | null; status: string } | null;
    circlesOrganising: { id: string; slug: string | null; name: string }[];
  } = { personal: !!req.resident, vendor: null, circlesOrganising: [] };

  // Vendor capability: either this request already IS the vendor session, or
  // the signed-in resident has a linked vendor account.
  if (req.user && req.user.role === "vendor") {
    workspaces.vendor = { businessName: req.user.businessName, orgId: req.user.orgId, status: req.user.status };
  } else if (req.resident) {
    const linked = (await db
      .prepare(`SELECT business_name, org_id, status FROM users WHERE resident_id = ? AND role = 'vendor'`)
      .get(req.resident.id)) as { business_name: string; org_id: string | null; status: string } | undefined;
    if (linked) workspaces.vendor = { businessName: linked.business_name, orgId: linked.org_id, status: linked.status };
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
