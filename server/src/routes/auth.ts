import crypto from "node:crypto";
import { Router } from "express";
import {
  SESSION_COOKIE,
  createSession,
  createUser,
  destroySession,
  findUserByEmail,
  findUserByGoogleUid,
  hashPassword,
  linkUserGoogleUid,
  orgVendorIds,
  requireVendorOrAdmin,
  verifyPassword,
} from "../auth.js";
import { db } from "../db/index.js";
import { sendMail } from "../email.js";
import { GoogleAuthNotConfigured, verifyGoogleIdToken } from "../googleAuth.js";
import { googleAuthLimiter, magicLinkLimiter, passwordLoginLimiter } from "../rateLimit.js";
import { CLIENT_URL } from "../stripe.js";
import { TERMS_VERSION } from "../terms.js";

export const authRouter = Router();

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

interface VendorSignupIntake {
  email: string;
  name: string;
  vendorType: "community" | "sports";
  businessName: string;
  address: string;
  county: string;
  mobile: string;
  landline?: string;
  description: string;
}

function validateVendorSignupIntake(body: Record<string, unknown>): { error: string } | { intake: VendorSignupIntake } {
  const { email, name, vendorType, businessName, address, county, mobile, landline, description } = body as Record<string, string | undefined>;
  if (!email || !name) return { error: "Name and email are required" };
  if (!vendorType || !["community", "sports"].includes(vendorType)) {
    return { error: "Please choose whether you run a community centre or a sports club" };
  }
  if (!businessName || !address || !county || !mobile || !description) {
    return { error: "Business name, address, county, mobile number and description are required" };
  }
  return { intake: { email, name, vendorType: vendorType as "community" | "sports", businessName, address, county, mobile, landline, description } };
}

// Public signup only ever creates vendor accounts, starting as pending until
// an admin approves them. Admin accounts are seeded, not self-served. No
// session is created here — the vendor has to log in themselves once
// approved, rather than landing on an already-"logged in" header straight
// after registering. Same shape whether the credential is a password
// (POST /signup) or a verified Google identity (POST /signup-google) — only
// how `passwordPlain`/`googleUid` got produced differs between the two
// callers below.
//
// A draft centre/club listing is created in the same transaction so the
// vendor's registration is immediately visible to admin (Pending approval
// tab/stats) and pre-fills the vendor's dashboard once approved — see
// ListingsTab's "Setup" vs "Edit" button in VendorDashboard.tsx.
async function createVendorSignup(
  intake: VendorSignupIntake,
  passwordPlain: string,
  marketingConsent: boolean,
  googleUid?: string
) {
  return db.transaction(async (tx) => {
    // Every vendor gets their own 1:1 organisation at signup (Phase C) —
    // matches the backfill initSchema() runs for every vendor who existed
    // before this, so org_id is never null for any vendor going forward.
    const orgId = crypto.randomUUID();
    await tx.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, ?, 'vendor')`).run(orgId, intake.businessName);

    const user = await createUser(
      intake.email,
      passwordPlain,
      intake.name,
      "vendor",
      "pending",
      {
        vendorType: intake.vendorType,
        businessName: intake.businessName,
        address: intake.address,
        county: intake.county,
        mobile: intake.mobile,
        landline: intake.landline ?? "",
        description: intake.description,
      },
      tx,
      { orgId }
    );
    await tx
      .prepare(`UPDATE users SET google_uid = ?, terms_accepted_at = NOW(), terms_version = ?, marketing_consent = ? WHERE id = ?`)
      .run(googleUid ?? null, TERMS_VERSION, marketingConsent ? 1 : 0, user.id);

    const listingId = crypto.randomUUID();
    if (intake.vendorType === "community") {
      await tx.prepare(
        `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, '', ?, ?, 'pending', NOW())`
      ).run(listingId, intake.businessName, intake.address, intake.county, intake.businessName, intake.mobile, intake.description, user.id);
      // "Rooms" is a pure internal implementation detail (see vendor.ts) —
      // every centre gets exactly one, matching its own capacity/rate.
      await tx.prepare(
        `INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order) VALUES (?, ?, 'Main Room', 0, 0, '', 0)`
      ).run(crypto.randomUUID(), listingId);
    } else {
      await tx.prepare(
        `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, created_at)
         VALUES (?, ?, '', ?, ?, '', 0, 'year', 0, ?, '', ?, ?, 'pending', NOW())`
      ).run(listingId, intake.businessName, intake.address, intake.county, intake.mobile, intake.description, user.id);
    }
    return user;
  });
}

authRouter.post("/signup", async (req, res) => {
  const { password, termsAccepted, marketingConsent } = req.body as { password?: string; termsAccepted?: boolean; marketingConsent?: boolean };
  if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!termsAccepted) return res.status(400).json({ error: "Please accept the Terms to continue" });
  const validated = validateVendorSignupIntake(req.body);
  if ("error" in validated) return res.status(400).json({ error: validated.error });
  if (await findUserByEmail(validated.intake.email)) return res.status(409).json({ error: "An account with that email already exists" });

  // The findUserByEmail check above is a pre-check, not a lock — two
  // concurrent signups for the same brand-new email can both pass it and
  // race each other into createVendorSignup's INSERT. users.email's UNIQUE
  // constraint is what actually decides the winner; without this catch the
  // loser's ER_DUP_ENTRY would surface as index.ts's generic final-error-
  // handler 500 instead of a controlled, actionable 409 (duplicate-account-
  // prevention audit finding).
  try {
    const user = await createVendorSignup(validated.intake, password, !!marketingConsent);
    res.status(201).json({ user });
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return res.status(409).json({ error: "An account with that email already exists" });
    throw e;
  }
});

// Google-authenticated vendor signup — same full listing intake and 'pending'
// admin-approval gate as POST /signup above (see "Who uses this" in
// CLAUDE.md: a vendor account is never created without one), just backed by
// a verified Google identity instead of a chosen password. The account still
// gets a real (random, never-revealed) password hash, since users.password_hash
// is NOT NULL — the vendor can set a real one later via the existing forgot-
// password flow if they ever want a non-Google way in. No session on success,
// same as password signup: they log in themselves once approved.
authRouter.post("/signup-google", googleAuthLimiter, async (req, res) => {
  const { idToken, termsAccepted, marketingConsent, ...rest } = req.body as {
    idToken?: string;
    termsAccepted?: boolean;
    marketingConsent?: boolean;
    [key: string]: unknown;
  };
  if (!idToken) return res.status(400).json({ error: "Missing Google sign-in token" });
  if (!termsAccepted) return res.status(400).json({ error: "Please accept the Terms to continue" });

  let identity;
  try {
    identity = await verifyGoogleIdToken(idToken);
  } catch (e) {
    if (e instanceof GoogleAuthNotConfigured) return res.status(503).json({ error: "Google sign-in isn't set up yet — please use email instead" });
    throw e;
  }
  if (!identity) return res.status(401).json({ error: "Couldn't verify that Google sign-in — please try again" });

  const validated = validateVendorSignupIntake({ ...rest, email: identity.email });
  if ("error" in validated) return res.status(400).json({ error: validated.error });
  if (await findUserByEmail(identity.email)) {
    return res.status(409).json({ error: "An account with that email already exists — try logging in instead." });
  }

  // Same pre-check-isn't-a-lock race as POST /signup above — see its comment.
  const throwawayPassword = crypto.randomBytes(32).toString("hex");
  try {
    const user = await createVendorSignup(validated.intake, throwawayPassword, !!marketingConsent, identity.uid);
    res.status(201).json({ user });
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "An account with that email already exists — try logging in instead." });
    }
    throw e;
  }
});

authRouter.post("/login", passwordLoginLimiter, async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const found = await findUserByEmail(email);
  if (!found || !verifyPassword(password, found.passwordHash)) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }
  if (found.status === "suspended") return res.status(403).json({ error: "This account has been suspended" });

  // Same "soft, self-reversing" deactivation as residents (guestAuth.ts) —
  // signing back in is itself the reactivation, no separate flow needed.
  await db.prepare(`UPDATE users SET deactivated_at = NULL WHERE id = ?`).run(found.id);

  const { token } = await createSession(found.id);
  res.cookie(SESSION_COOKIE, token, cookieOpts);
  const { passwordHash: _passwordHash, ...user } = found;
  res.json({ user });
});

// Google sign-in — login only, never signup: a vendor account requires the
// full listing intake POST /signup above does in one transaction, which a
// bare Google identity can't supply, and creating one here would let
// anyone with a Google account skip admin approval entirely. An email with
// no matching account is sent back to /vendor/signup instead.
//
// Account-linking audit finding: this used to auto-link a verified Google
// email onto any existing vendor/admin account with a matching email — that
// was custom application logic (Firebase's own documented behaviour here,
// with this project's default "one account per email" setting, is the
// opposite: it refuses to silently attach a second provider and surfaces
// `auth/account-exists-with-different-credential`, expecting the app to run
// an explicit, verified linking step instead). Fixed: an existing account
// matched only by email is no longer logged into or linked here — see
// PUT /link-google below for the replacement, which only ever runs from an
// already-authenticated session.
authRouter.post("/google", googleAuthLimiter, async (req, res) => {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) return res.status(400).json({ error: "Missing Google sign-in token" });

  let identity;
  try {
    identity = await verifyGoogleIdToken(idToken);
  } catch (e) {
    if (e instanceof GoogleAuthNotConfigured) return res.status(503).json({ error: "Google sign-in isn't set up yet — please use email instead" });
    throw e;
  }
  if (!identity) return res.status(401).json({ error: "Couldn't verify that Google sign-in — please try again" });

  const user = await findUserByGoogleUid(identity.uid);
  if (!user) {
    if (await findUserByEmail(identity.email)) {
      return res.status(409).json({
        error: "An account already exists for this email — log in with your password, then link Google from your account settings.",
        accountExists: true,
      });
    }
    return res
      .status(404)
      .json({ error: "No HelloCircle account found for that Google account — list your venue or club to get started.", noAccount: true });
  }
  if (user.status === "suspended") return res.status(403).json({ error: "This account has been suspended" });

  // Same "soft, self-reversing" reactivation as POST /login above.
  await db.prepare(`UPDATE users SET deactivated_at = NULL WHERE id = ?`).run(user.id);

  const { token } = await createSession(user.id);
  res.cookie(SESSION_COOKIE, token, cookieOpts);
  res.json({ user });
});

// Explicit "link my Google account" from an already-authenticated session —
// the replacement for the auto-link-on-email-match behaviour above. Being
// logged in here already proves control of this account, so no further
// proof-of-control step is needed to attach a Google identity onto it.
authRouter.put("/link-google", requireVendorOrAdmin, googleAuthLimiter, async (req, res) => {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) return res.status(400).json({ error: "Missing Google sign-in token" });

  let identity;
  try {
    identity = await verifyGoogleIdToken(idToken);
  } catch (e) {
    if (e instanceof GoogleAuthNotConfigured) return res.status(503).json({ error: "Google sign-in isn't set up yet" });
    throw e;
  }
  if (!identity) return res.status(401).json({ error: "Couldn't verify that Google sign-in — please try again" });

  const existing = await findUserByGoogleUid(identity.uid);
  if (existing && existing.id !== req.user!.id) {
    return res.status(409).json({ error: "This Google account is already linked to a different HelloCircle account" });
  }
  await linkUserGoogleUid(req.user!.id, identity.uid);
  res.json({ ok: true, googleEmail: identity.email });
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await destroySession(token);
  res.clearCookie(SESSION_COOKIE, cookieOpts);
  res.json({ ok: true });
});

authRouter.get("/me", async (req, res) => {
  if (!req.user) return res.json({ user: null });
  // termsAcceptedAt (onboarding audit E1) lets the client ask an account with
  // no acceptance on file to confirm — kept out of AuthedUser itself so the
  // many places that build/select that shape don't all need to change.
  const row = (await db.prepare(`SELECT terms_accepted_at as termsAcceptedAt FROM users WHERE id = ?`).get(req.user.id)) as
    | { termsAcceptedAt: string | null }
    | undefined;
  res.json({ user: { ...req.user, termsAcceptedAt: row?.termsAcceptedAt ?? null } });
});

// Renewed Terms acceptance for a vendor account with none on file (onboarding
// audit E1) — see POST /residents/me/accept-terms for the shared rules: an
// explicit termsAccepted:true is required, only a NULL is ever filled, and
// nothing is inferred from being signed in. Admin accounts are seeded, not
// self-served, so they're out of scope here.
authRouter.post("/accept-terms", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Login required" });
  if (req.user.role !== "vendor") return res.status(403).json({ error: "Not applicable to this account" });
  const { termsAccepted } = req.body as { termsAccepted?: boolean };
  if (!termsAccepted) return res.status(400).json({ error: "Please accept the Terms to continue" });
  await db.prepare(`UPDATE users SET terms_accepted_at = NOW(), terms_version = ? WHERE id = ? AND terms_accepted_at IS NULL`).run(TERMS_VERSION, req.user.id);
  res.json({ ok: true });
});

// Vendor setup checklist (onboarding audit G2). Deliberately NOT behind
// requireVendor: a pending vendor is exactly who needs this, and every
// requireVendor route 403s until an admin approves them. Read-only, scoped to
// the caller's own organisation, and derived entirely from saved state — no
// client-side flags. Steps in the "after_approval" phase are only actionable
// once approved (the listing editor is requireVendor-gated).
authRouter.get("/setup-status", async (req, res) => {
  if (!req.user || req.user.role !== "vendor") return res.status(401).json({ error: "Vendor login required" });
  const u = (await db
    .prepare(`SELECT terms_accepted_at as termsAcceptedAt, business_name as businessName, address, county, mobile, description, status FROM users WHERE id = ?`)
    .get(req.user.id)) as { termsAcceptedAt: string | null; businessName: string; address: string; county: string; mobile: string; description: string | null; status: string } | undefined;
  if (!u) return res.status(404).json({ error: "Account not found" });

  const ids = await orgVendorIds(req.user);
  const ph = ids.map(() => "?").join(",");
  const centre = (await db
    .prepare(`SELECT id, image_url as imageUrl, status, capacity FROM centres WHERE vendor_id IN (${ph}) AND status != 'deleted' ORDER BY created_at LIMIT 1`)
    .get(...ids)) as { id: string; imageUrl: string; status: string; capacity: number } | undefined;
  const club = centre
    ? undefined
    : ((await db
        .prepare(`SELECT id, image_url as imageUrl, status, sport, ages FROM clubs WHERE vendor_id IN (${ph}) AND status != 'deleted' ORDER BY created_at LIMIT 1`)
        .get(...ids)) as { id: string; imageUrl: string; status: string; sport: string; ages: string } | undefined);

  const listing = centre ? { type: "centre" as const, id: centre.id } : club ? { type: "club" as const, id: club.id } : null;
  const detailsDone = !!(u.businessName && u.address && u.county && u.mobile && u.description);
  const approved = u.status === "approved";

  type Step = { key: string; label: string; done: boolean; phase: "submitted" | "review" | "after_approval" };
  const steps: Step[] = [
    { key: "account", label: "Account created", done: true, phase: "submitted" },
    { key: "terms", label: "Terms accepted", done: !!u.termsAcceptedAt, phase: "submitted" },
    { key: "details", label: "Business details submitted", done: detailsDone, phase: "submitted" },
    { key: "listing", label: "Listing draft created", done: !!listing, phase: "submitted" },
    { key: "review", label: "Admin review", done: approved, phase: "review" },
    { key: "photo", label: "Add a cover photo", done: !!(centre?.imageUrl || club?.imageUrl), phase: "after_approval" },
    centre
      ? { key: "capacity", label: "Set your room capacity", done: centre.capacity > 0, phase: "after_approval" as const }
      : { key: "club_details", label: "Add your sport and age range", done: !!(club?.sport && club?.ages), phase: "after_approval" as const },
    { key: "live", label: "Listing live to the public", done: (centre ?? club)?.status === "approved", phase: "after_approval" },
  ];
  res.json({ accountStatus: u.status, listing, steps, complete: steps.every((s) => s.done) });
});

// --- password reset (Phase A) — vendor/admin only; residents are
// passwordless (magic link). Same single-use/expiry shape as the guest
// magic-link flow in guestAuth.ts, reusing its rate limiter since both are
// "email a link a stranger could spam someone else with" surfaces.

authRouter.post("/request-reset", magicLinkLimiter, async (req, res) => {
  const { email } = req.body as { email?: string };
  // Always respond the same way regardless of whether the account exists —
  // same no-existence-leak principle as guestAuth.ts's request-link route.
  if (email) {
    const user = await findUserByEmail(email);
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      await db.prepare(`INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`).run(token, user.id);
      const resetUrl = `${CLIENT_URL}/reset-password?token=${token}`;
      await sendMail({
        to: user.email,
        subject: "Reset your Hello Circle password",
        text: `Hi,\n\nClick the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 30 minutes and can only be used once. If you didn't request this, you can safely ignore it.\n\nThanks for using Hello Circle.`,
        cta: { label: "Reset password", url: resetUrl },
      });
    }
  }
  res.json({ ok: true });
});

// --- staff invite acceptance (Phase C) ------------------------------------

// Onboarding audit (consent pass) — this was the one account-creation path
// in the whole app with no Terms acceptance at all, ever: AcceptInvite.tsx
// had no checkbox, and this route never set terms_accepted_at (createUser()
// leaves it null; nothing below used to update it the way createVendorSignup
// above does). An org owner's invite is a real vetting step for *joining
// this organisation*, but it was never a substitute for the invited person's
// own agreement to HelloCircle's Terms — same reasoning every other signup
// path already applies. termsAccepted is required server-side now, same
// pattern (and same wording/UI) as every other signup form.
authRouter.post("/accept-invite", passwordLoginLimiter, async (req, res) => {
  const { token, name, password, termsAccepted, marketingConsent } = req.body as {
    token?: string;
    name?: string;
    password?: string;
    termsAccepted?: boolean;
    marketingConsent?: boolean;
  };
  if (!token || !name || !password) return res.status(400).json({ error: "Name and password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!termsAccepted) return res.status(400).json({ error: "Please accept the Terms to continue" });

  const invite = (await db
    .prepare(`SELECT org_id as orgId, email, platform_role as platformRole FROM org_invites WHERE token = ? AND status = 'pending' AND expires_at > NOW()`)
    .get(token)) as { orgId: string; email: string; platformRole: string } | undefined;
  if (!invite) return res.status(400).json({ error: "This invite has expired or is no longer valid" });
  if (await findUserByEmail(invite.email)) return res.status(409).json({ error: "An account with that email already exists" });

  // Invited staff skip the pending-admin-approval step new self-serve
  // vendor signups go through — the org owner inviting them by email is
  // the vetting step here, not a second admin review.
  const user = await db.transaction(async (tx) => {
    const u = await createUser(invite.email, password, name, "vendor", "approved", undefined, tx, {
      orgId: invite.orgId,
      platformRole: invite.platformRole,
      invitedStaff: true,
    });
    await tx.prepare(`UPDATE users SET terms_accepted_at = NOW(), terms_version = ?, marketing_consent = ? WHERE id = ?`).run(TERMS_VERSION, marketingConsent ? 1 : 0, u.id);
    await tx.prepare(`UPDATE org_invites SET status = 'accepted' WHERE token = ?`).run(token);
    return u;
  });

  const { token: sessionToken } = await createSession(user.id);
  res.cookie(SESSION_COOKIE, sessionToken, cookieOpts);
  res.status(201).json({ user });
});

authRouter.post("/reset-password", passwordLoginLimiter, async (req, res) => {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password) return res.status(400).json({ error: "Token and new password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const row = (await db.prepare(`SELECT user_id as userId FROM password_reset_tokens WHERE token = ? AND expires_at > NOW()`).get(token)) as
    | { userId: string }
    | undefined;
  if (!row) return res.status(400).json({ error: "This link has expired or has already been used — request a new one" });

  await db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(password), row.userId);
  await db.prepare(`DELETE FROM password_reset_tokens WHERE token = ?`).run(token);
  res.json({ ok: true });
});

/** Host Manage spec §28 — an authenticated "change my password" while
 * logged in. Only the unauthenticated forgot-password email flow above
 * existed before this; that flow stays as the recovery path when a vendor
 * doesn't remember their current password at all. */
authRouter.put("/password", requireVendorOrAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Current and new password are required" });
  if (newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });

  const row = (await db.prepare(`SELECT password_hash as passwordHash FROM users WHERE id = ?`).get(req.user!.id)) as { passwordHash: string } | undefined;
  if (!row || !verifyPassword(currentPassword, row.passwordHash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  await db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(newPassword), req.user!.id);
  res.json({ ok: true });
});

/** Host Manage spec §28 — vendor/admin account deactivation, same "soft,
 * self-reversing" pattern as residents.ts's own POST /me/deactivate: not a
 * hard lock, just a status toggle a subsequent login itself clears (see
 * POST /login above). Ends the current session immediately, same as a
 * manual sign-out and for the same reason residents.ts's identical route
 * does — staying logged in while deactivated makes no sense. */
authRouter.post("/deactivate", requireVendorOrAdmin, async (req, res) => {
  await db.prepare(`UPDATE users SET deactivated_at = NOW() WHERE id = ?`).run(req.user!.id);
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) await destroySession(token);
  res.clearCookie(SESSION_COOKIE, cookieOpts);
  res.json({ ok: true });
});
