import crypto from "node:crypto";
import { Router } from "express";
import { hashPassword, verifyPassword } from "../auth.js";
import { db } from "../db/index.js";
import { sendMail } from "../email.js";
import { GUEST_SESSION_COOKIE, bearerTokenFrom, consumeLoginToken, createGuestSession, createLoginToken, destroyGuestSession } from "../guestAuth.js";
import { magicLinkLimiter, passwordLoginLimiter } from "../rateLimit.js";
import { createResidentWithPassword, findOrCreateResident, getResidentPasswordHash, setResidentPassword } from "../residents.js";
import { CLIENT_URL } from "../stripe.js";
import { isValidEmail } from "../util.js";

export const guestAuthRouter = Router();

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

/** Always responds the same way regardless of whether the email has any
 * bookings — same no-existence-leak principle as the ref+email lookup
 * routes. A stranger entering someone else's email just results in an
 * unsolicited "sign in" email landing in their inbox (the standard
 * passwordless-auth tradeoff), not any access — that still requires reading
 * the link out of that inbox. */
guestAuthRouter.post("/request-link", magicLinkLimiter, async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email || !isValidEmail(email)) return res.status(400).json({ error: "A valid email address is required" });

  const { token } = await createLoginToken(email);
  // Mobile app (no cookie jar) needs the link to hand off into the native
  // app instead of the web's /bookings page — see /mobile-verify in
  // server/src/index.ts. Web callers never send this header.
  const isNative = req.header("X-Client-Platform") === "mobile";
  const link = isNative ? `${CLIENT_URL}/mobile-verify?token=${token}` : `${CLIENT_URL}/bookings?token=${token}`;
  await sendMail({
    to: email.trim(),
    subject: "Sign in to Hello Circle",
    text: `Hi,\n\nClick the link below to see all your bookings and club registrations:\n\n${link}\n\nThis link expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore it.\n\nThanks for using Hello Circle.`,
    cta: { label: "Sign in to Hello Circle", url: link },
    replyTo: "support@hellocircle.ie",
  });
  res.json({ ok: true });
});

guestAuthRouter.post("/verify", async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: "Token is required" });

  const email = await consumeLoginToken(token);
  if (!email) return res.status(400).json({ error: "This link has expired or has already been used — request a new one" });

  const { token: sessionToken } = await createGuestSession(email);
  // Cookie is set unconditionally — a harmless no-op for a native fetch
  // caller with no cookie jar. Promotes the verified email into a
  // persistent resident profile the first time it's seen — idempotent on
  // every later sign-in. See residents.ts; this is what makes
  // household/favourites/notifications possible without requiring a
  // password or a separate signup step.
  res.cookie(GUEST_SESSION_COOKIE, sessionToken, cookieOpts);
  await findOrCreateResident(email);
  // Proof of inbox access — set once, on the first magic-link verify ever
  // (COALESCE keeps the original timestamp on every later one). Password-
  // only signup below never reaches this route, so never sets it.
  await db.prepare(`UPDATE residents SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE email = ?`).run(email);
  // Mobile has no cookie jar, so it needs the raw session token back in the
  // response body instead — additive only, web's response shape is unchanged.
  const isNative = req.header("X-Client-Platform") === "mobile";
  res.json(isNative ? { email, token: sessionToken } : { email });
});

// Optional password login (My Life redesign) — a second, opt-in way into
// the exact same resident identity/session the magic-link flow above
// already creates (same GUEST_SESSION_COOKIE, same req.resident downstream).
// Nobody is required to set a password; the email-link flow keeps working
// unchanged for anyone who never touches these two routes.
guestAuthRouter.post("/signup", passwordLoginLimiter, async (req, res) => {
  const { name, email, password } = req.body as { name?: string; email?: string; password?: string };
  if (!email || !isValidEmail(email)) return res.status(400).json({ error: "A valid email address is required" });
  if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const resident = await createResidentWithPassword(email, hashPassword(password), name ?? "");
  if (!resident) return res.status(409).json({ error: "An account already exists for this email — try logging in instead." });

  const { token: sessionToken } = await createGuestSession(resident.email);
  res.cookie(GUEST_SESSION_COOKIE, sessionToken, cookieOpts);
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
