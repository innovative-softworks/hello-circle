import { Router } from "express";
import { sendMail } from "../email.js";
import { GUEST_SESSION_COOKIE, consumeLoginToken, createGuestSession, createLoginToken, destroyGuestSession } from "../guestAuth.js";
import { magicLinkLimiter } from "../rateLimit.js";
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
  await sendMail({
    to: email.trim(),
    subject: "Sign in to Hello Circle",
    text: `Hi,\n\nClick the link below to see all your bookings and club registrations:\n\n${CLIENT_URL}/bookings?token=${token}\n\nThis link expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore it.\n\nThanks for using Hello Circle.`,
  });
  res.json({ ok: true });
});

guestAuthRouter.post("/verify", async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: "Token is required" });

  const email = await consumeLoginToken(token);
  if (!email) return res.status(400).json({ error: "This link has expired or has already been used — request a new one" });

  const { token: sessionToken } = await createGuestSession(email);
  res.cookie(GUEST_SESSION_COOKIE, sessionToken, cookieOpts);
  res.json({ email });
});

guestAuthRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[GUEST_SESSION_COOKIE];
  if (token) await destroyGuestSession(token);
  res.clearCookie(GUEST_SESSION_COOKIE, cookieOpts);
  res.json({ ok: true });
});

guestAuthRouter.get("/me", (req, res) => {
  res.json({ email: req.guestEmail ?? null });
});
