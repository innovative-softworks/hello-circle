import crypto from "node:crypto";
import { Router } from "express";
import { hashPassword, verifyPassword } from "../auth.js";
import { db } from "../db/index.js";
import { sendMail } from "../email.js";
import { GoogleAuthNotConfigured, verifyGoogleIdToken } from "../googleAuth.js";
import {
  GUEST_SESSION_COOKIE,
  bearerTokenFrom,
  consumeLoginToken,
  consumeResidentSignupToken,
  createGuestSession,
  createLoginToken,
  createResidentSignupToken,
  destroyGuestSession,
} from "../guestAuth.js";
import { googleAuthLimiter, magicLinkLimiter, passwordLoginLimiter } from "../rateLimit.js";
import {
  createResidentFromGoogle,
  createResidentFromMagicLink,
  createResidentWithPassword,
  findOrCreateResident,
  getResidentByEmail,
  getResidentPasswordHash,
  resolveGoogleSignIn,
  ResidentEmailTakenError,
  ResidentSignupRaceError,
  setResidentPassword,
  type Resident,
} from "../residents.js";
import { CLIENT_URL } from "../stripe.js";
import { isValidEmail } from "../util.js";

export const guestAuthRouter = Router();

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

// Onboarding audit F-1 fix — same open-redirect/loop guard as
// client/src/authRedirect.ts's safeReturnTo(), re-implemented here because
// the two run in different processes and this app has no shared types
// package (see CLAUDE.md). Only a same-origin relative path that isn't
// itself an auth page is ever embedded in an emailed link; anything else
// (missing, absolute, protocol-relative, or an auth page) is dropped
// entirely, so the caller falls back to the existing default ("/bookings").
const AUTH_PAGE_PATHS = ["/login", "/signin", "/accept-invite", "/forgot-password", "/reset-password", "/vendor/signup"];
export function safeEmailedReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.length > 2000) return null;
  // Backslashes normalise to slashes in browsers ("/\evil.com" == "//evil.com"); control chars are never valid.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  const path = raw.split("?")[0].split("#")[0];
  if (AUTH_PAGE_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return raw;
}

/** Always responds the same way regardless of whether the email has any
 * bookings — same no-existence-leak principle as the ref+email lookup
 * routes. A stranger entering someone else's email just results in an
 * unsolicited "sign in" email landing in their inbox (the standard
 * passwordless-auth tradeoff), not any access — that still requires reading
 * the link out of that inbox. */
guestAuthRouter.post("/request-link", magicLinkLimiter, async (req, res) => {
  const { email, returnTo } = req.body as { email?: string; returnTo?: string };
  if (!email || !isValidEmail(email)) return res.status(400).json({ error: "A valid email address is required" });

  const { token } = await createLoginToken(email);
  // Mobile app (no cookie jar) needs the link to hand off into the native
  // app instead of the web's /bookings page — see /mobile-verify in
  // server/src/index.ts. Web callers never send this header.
  const isNative = req.header("X-Client-Platform") === "mobile";
  // Onboarding audit F-1 — previously always /bookings?token=..., which
  // silently dropped whatever the person was trying to do (join a Circle/
  // Game, complete a booking) before choosing the passwordless option; the
  // password/Google sign-in paths already preserve this via `returnTo` (see
  // SignIn.tsx). The verify destination still lives on /bookings (MyBookings.tsx
  // owns token consumption) — returnTo just tells it where to go next.
  const params = new URLSearchParams({ token });
  if (!isNative) {
    const safeReturn = safeEmailedReturnTo(returnTo);
    if (safeReturn) params.set("returnTo", safeReturn);
  }
  const link = isNative ? `${CLIENT_URL}/mobile-verify?token=${token}` : `${CLIENT_URL}/bookings?${params.toString()}`;
  await sendMail({
    to: email.trim(),
    subject: "Sign in to Hello Circle",
    text: `Hi,\n\nClick the link below to see all your bookings and club registrations:\n\n${link}\n\nThis link expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore it.\n\nThanks for using Hello Circle.`,
    cta: { label: "Sign in to Hello Circle", url: link },
    replyTo: "support@hellocircle.ie",
  });
  res.json({ ok: true });
});

// Onboarding audit (consent pass, 2026-09-25) — a returning resident (a row
// already exists for the verified email) signs straight in, exactly as
// before. A brand-new email used to silently become a full account here too
// (findOrCreateResident, unconditionally) — that's the one consent gap this
// route had: opening an emailed link proves inbox access, not agreement to
// Terms, so a resident row must not be created — and Terms/marketing
// consent must not be recorded — until that's actually asked. This now
// mirrors the two-step shape POST /google below already uses: verify
// returns "needs_completion" (no row, no session) for a new email; POST
// /verify/complete (below) is what actually creates the account, once Terms
// are accepted. The web client (MyBookings.tsx) shows an inline "Complete
// your account" panel for this case, carrying the original `returnTo`
// forward exactly as it already did.
guestAuthRouter.post("/verify", async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: "Token is required" });

  const email = await consumeLoginToken(token);
  if (!email) return res.status(400).json({ error: "This link has expired or has already been used — request a new one" });

  const isNative = req.header("X-Client-Platform") === "mobile";
  const existing = await getResidentByEmail(email);

  if (!existing) {
    if (isNative) {
      // Legacy native behaviour, preserved byte-for-byte: the Expo app
      // (a separate repo — see hello-circle-mobile) has no "complete your
      // account" screen built for this yet, so changing its response shape
      // here would break it with no way to fix that app from this repo.
      // Deliberately does NOT set terms_accepted_at — no consent was
      // actually captured on this path, and fabricating that timestamp
      // would be worse than leaving it null. Known, flagged gap: native
      // magic-link signup still doesn't capture Terms acceptance.
      const resident = await findOrCreateResident(email);
      const { token: sessionToken } = await createGuestSession(resident.email);
      res.cookie(GUEST_SESSION_COOKIE, sessionToken, cookieOpts);
      await db.prepare(`UPDATE residents SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE email = ?`).run(email);
      return res.json({ email: resident.email, token: sessionToken });
    }
    const { token: completionToken } = await createResidentSignupToken(email);
    return res.json({ status: "needs_completion", email, completionToken });
  }

  const { token: sessionToken } = await createGuestSession(existing.email);
  res.cookie(GUEST_SESSION_COOKIE, sessionToken, cookieOpts);
  // Proof of inbox access — set once, on the first magic-link verify ever
  // (COALESCE keeps the original timestamp on every later one). Password-
  // only signup never reaches this route, so never sets it that way (see
  // POST /guest/signup's own confirmation-email flow for that path instead).
  await db.prepare(`UPDATE residents SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE email = ?`).run(email);
  res.json(isNative ? { status: "signed_in", email: existing.email, token: sessionToken } : { status: "signed_in", email: existing.email });
});

// Completes a brand-new magic-link signup after the "Complete your
// HelloCircle account" screen — mirrors POST /google/complete's shape
// exactly (see its own comment below). The resident row, and any session,
// don't exist until this runs; see the long comment on POST /verify above.
// completionToken is single-use — a genuine double-submit re-hits
// createResidentFromMagicLink's own idempotent-on-conflict handling only if
// the token is still valid; a retry after the token's already been consumed
// gets the same "expired" error a stale/reused login token would (same
// tradeoff the rest of this codebase's single-use tokens already accept).
guestAuthRouter.post("/verify/complete", async (req, res) => {
  const { completionToken, name, termsAccepted, marketingConsent } = req.body as {
    completionToken?: string;
    name?: string;
    termsAccepted?: boolean;
    marketingConsent?: boolean;
  };
  if (!completionToken) return res.status(400).json({ error: "Missing completion token" });
  if (!termsAccepted) return res.status(400).json({ error: "Please accept the Terms to continue" });

  const email = await consumeResidentSignupToken(completionToken);
  if (!email) return res.status(400).json({ error: "This link has expired — request a new sign-in link" });

  const resident = await createResidentFromMagicLink(email, name ?? "", !!marketingConsent);
  const { token: sessionToken } = await createGuestSession(resident.email);
  res.cookie(GUEST_SESSION_COOKIE, sessionToken, cookieOpts);
  const isNative = req.header("X-Client-Platform") === "mobile";
  res.json(isNative ? { email: resident.email, token: sessionToken } : { email: resident.email });
});

// Optional password login (My Life redesign) — a second, opt-in way into
// the exact same resident identity/session the magic-link flow above
// already creates (same GUEST_SESSION_COOKIE, same req.resident downstream).
// Nobody is required to set a password; the email-link flow keeps working
// unchanged for anyone who never touches these two routes.
//
// termsAccepted is required (auth UX audit finding C8) — this was the one
// resident signup path that didn't enforce it server-side, unlike Google
// completion (POST /guest/google/complete above) and vendor signup
// (routes/auth.ts's POST /signup), which always have.
guestAuthRouter.post("/signup", passwordLoginLimiter, async (req, res) => {
  const { name, email, password, termsAccepted, marketingConsent } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    termsAccepted?: boolean;
    marketingConsent?: boolean;
  };
  if (!email || !isValidEmail(email)) return res.status(400).json({ error: "A valid email address is required" });
  if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!termsAccepted) return res.status(400).json({ error: "Please accept the Terms to continue" });

  let resident;
  try {
    resident = await createResidentWithPassword(email, hashPassword(password), name ?? "", true, !!marketingConsent);
  } catch (e) {
    if (e instanceof ResidentSignupRaceError) return res.status(409).json({ error: "An account already exists for this email — try logging in instead." });
    throw e;
  }
  if (!resident) return res.status(409).json({ error: "An account already exists for this email — try logging in instead." });

  const { token: sessionToken } = await createGuestSession(resident.email);
  res.cookie(GUEST_SESSION_COOKIE, sessionToken, cookieOpts);

  // Onboarding audit F-4 — password signup was the one resident signup path
  // that never proved inbox access (magic-link verify and Google completion
  // both do, via email_verified_at). Reuses the exact same token mechanism
  // as passwordless sign-in rather than a new one: clicking it still hits
  // POST /guest/verify, which sets email_verified_at via COALESCE regardless
  // of which flow got there. Purely additive — the person is already signed
  // in from the cookie set above, this just closes the verification gap.
  // sendMail() never throws (see email.ts), so this can't fail the signup.
  const { token: verifyToken } = await createLoginToken(resident.email);
  const verifyUrl = `${CLIENT_URL}/bookings?token=${verifyToken}`;
  await sendMail({
    to: resident.email,
    subject: "Confirm your email — Hello Circle",
    text: `Hi,\n\nYou're signed in to Hello Circle. Click the link below any time to confirm this is your email address:\n\n${verifyUrl}\n\nThis link expires in 15 minutes and can only be used once.\n\nThanks for using Hello Circle.`,
    cta: { label: "Confirm my email", url: verifyUrl },
  });

  res.status(201).json({ email: resident.email });
});

guestAuthRouter.post("/login", passwordLoginLimiter, async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  // Same generic error whether the email doesn't exist, has no password set
  // yet (magic-link-only account), or the password is simply wrong — same
  // no-existence-leak principle /request-link already follows above.
  const existing = await getResidentPasswordHash(email);
  if (!existing?.passwordHash || !verifyPassword(password, existing.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const { token: sessionToken } = await createGuestSession(email.toLowerCase().trim());
  res.cookie(GUEST_SESSION_COOKIE, sessionToken, cookieOpts);
  res.json({ email: email.toLowerCase().trim() });
});

// Google sign-in (My Life redesign follow-up) — a third, opt-in way into
// the exact same resident identity/session the two flows above create (same
// GUEST_SESSION_COOKIE, same req.resident downstream).
//
// Three distinct outcomes, resolved by resolveGoogleSignIn without creating
// or linking anything itself:
//  - an existing resident already linked to this Google identity -> log in
//    immediately, same as password/magic-link (requirement: returning users
//    sign in directly).
//  - a brand-new identity, no resident row for this email at all -> respond
//    "needs_completion" with no session and no row created yet. Firebase has
//    proven the identity; the HelloCircle account doesn't exist until
//    POST /google/complete below actually creates it. Closing the tab here
//    leaves nothing behind to clean up or collide with on a later attempt.
//  - an existing resident with this email but no Google link yet -> 409,
//    NOT logged in, NOT linked. See residents.ts's resolveGoogleSignIn doc
//    comment for the account-linking audit this replaces (auto-linking on
//    email match was custom application logic, not Firebase's own
//    behaviour, and merging identities on email alone is exactly what a
//    verified provider assertion shouldn't be treated as sufficient for).
//    Linking a Google identity onto an existing account now only happens
//    from an authenticated session — POST /residents/me/google.
guestAuthRouter.post("/google", googleAuthLimiter, async (req, res) => {
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

  const lookup = await resolveGoogleSignIn(identity.uid, identity.email);
  if (lookup.kind === "email_taken") {
    return res.status(409).json({
      error: "An account already exists for this email — sign in with your password or an email link, then link Google from your profile settings.",
      accountExists: true,
    });
  }
  if (lookup.kind === "new") {
    return res.json({ status: "needs_completion", email: identity.email, name: identity.name, picture: identity.picture });
  }

  // createGuestSession also clears deactivated_at (self-reactivation) — same
  // as every other sign-in path here.
  const { token: sessionToken } = await createGuestSession(lookup.resident.email);
  res.cookie(GUEST_SESSION_COOKIE, sessionToken, cookieOpts);
  const isNative = req.header("X-Client-Platform") === "mobile";
  res.json(isNative ? { status: "signed_in", email: lookup.resident.email, token: sessionToken } : { status: "signed_in", email: lookup.resident.email });
});

// Completes a brand-new Google sign-in after the "Complete your HelloCircle
// account" screen — the resident row (and any session) doesn't exist until
// this runs; see the long comment on POST /google above. Re-verifies the
// same idToken rather than trusting anything cached from the earlier call,
// since there's no server-side session for a not-yet-created account to
// tie a "pending" state to.
guestAuthRouter.post("/google/complete", googleAuthLimiter, async (req, res) => {
  const { idToken, name, termsAccepted, marketingConsent } = req.body as {
    idToken?: string;
    name?: string;
    termsAccepted?: boolean;
    marketingConsent?: boolean;
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

  // Re-resolve rather than trusting the client's earlier /google response —
  // a double submit should just log in the now-existing account (idempotent,
  // not an error). Only the by-uid case is trusted directly here — an
  // "email_taken" read is a snapshot that a concurrent completion of this
  // exact identity could invalidate a moment later, so the real "is this
  // email genuinely someone else's" decision is left to
  // createResidentFromGoogle's own atomic insert-and-catch below, which
  // can't go stale the way a separate read can.
  const lookup = await resolveGoogleSignIn(identity.uid, identity.email);
  let resident: Resident;
  if (lookup.kind === "existing") {
    resident = lookup.resident;
  } else {
    try {
      resident = await createResidentFromGoogle(identity.uid, identity.email, (name ?? identity.name ?? "").trim(), identity.picture, !!marketingConsent);
    } catch (e) {
      if (e instanceof ResidentEmailTakenError) {
        return res.status(409).json({
          error: "An account already exists for this email — sign in with your password or an email link, then link Google from your profile settings.",
          accountExists: true,
        });
      }
      throw e;
    }
  }

  const { token: sessionToken } = await createGuestSession(resident.email);
  res.cookie(GUEST_SESSION_COOKIE, sessionToken, cookieOpts);
  const isNative = req.header("X-Client-Platform") === "mobile";
  res.json(isNative ? { email: resident.email, token: sessionToken } : { email: resident.email });
});

// Forgot/reset password for the resident password-login option above —
// same shape as auth.ts's vendor/admin request-reset/reset-password pair
// (30-minute single-use token, same no-existence-leak response), kept as
// its own token table/route pair rather than reused across both identity
// systems, since a resident and a vendor/admin are different tables with
// different session cookies.
guestAuthRouter.post("/request-password-reset", magicLinkLimiter, async (req, res) => {
  const { email } = req.body as { email?: string };
  if (email && isValidEmail(email)) {
    const existing = await getResidentPasswordHash(email);
    if (existing?.passwordHash) {
      const token = crypto.randomBytes(32).toString("hex");
      await db
        .prepare(`INSERT INTO resident_password_reset_tokens (token, email, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`)
        .run(token, email.toLowerCase().trim());
      const resetUrl = `${CLIENT_URL}/signin?resetToken=${token}`;
      await sendMail({
        to: email.trim(),
        subject: "Reset your HelloCircle password",
        text: `Hi,\n\nClick the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 30 minutes and can only be used once. If you didn't request this, you can safely ignore it.\n\nThanks for using Hello Circle.`,
        cta: { label: "Reset password", url: resetUrl },
      });
    }
  }
  // Always the same response, whether or not that email has a password-login
  // account — same principle as every other email-a-link route in this file.
  res.json({ ok: true });
});

guestAuthRouter.post("/reset-password", passwordLoginLimiter, async (req, res) => {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password) return res.status(400).json({ error: "Token and new password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const row = (await db.prepare(`SELECT email FROM resident_password_reset_tokens WHERE token = ? AND expires_at > NOW()`).get(token)) as
    | { email: string }
    | undefined;
  if (!row) return res.status(400).json({ error: "This link has expired or has already been used — request a new one" });

  const existing = await getResidentPasswordHash(row.email);
  if (!existing) return res.status(400).json({ error: "This link has expired or has already been used — request a new one" });

  await setResidentPassword(existing.id, hashPassword(password));
  await db.prepare(`DELETE FROM resident_password_reset_tokens WHERE token = ?`).run(token);

  const { token: sessionToken } = await createGuestSession(row.email);
  res.cookie(GUEST_SESSION_COOKIE, sessionToken, cookieOpts);
  res.json({ email: row.email });
});

guestAuthRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[GUEST_SESSION_COOKIE] || bearerTokenFrom(req);
  if (token) await destroyGuestSession(token);
  res.clearCookie(GUEST_SESSION_COOKIE, cookieOpts);
  res.json({ ok: true });
});

guestAuthRouter.get("/me", (req, res) => {
  res.json({ email: req.guestEmail ?? null });
});
