import { Router, type NextFunction, type Request, type Response } from "express";
import { InviteError, acceptAdminInvite, describeInvite } from "../adminInvites.js";
import { MfaError, confirmEnrolment, mfaStatus, regenerateRecoveryCodes, startEnrolment, verifyForSession } from "../adminMfa.js";
import { SESSION_COOKIE, createSession, mfaStale } from "../auth.js";
import { simpleRateLimit } from "../rateLimit.js";
import { cookieOpts } from "./auth.js";

// OG-06 / OG-07 — how an admin gets in.
// /api/auth/mfa: two-step sign-in for the admin session in this browser. These
//   routes accept a signed-in admin whose session hasn't entered a code yet
//   (that is how it becomes verified); everything under /api/admin refuses
//   such a session.
// /api/auth/admin-invite: a super admin's invitation link is checked and
//   accepted here; the new admin then sets up two-step sign-in.

const mfaLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const inviteLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

function adminSession(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Sign in first" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Two-step sign-in here is for HelloCircle admins" });
  if (!req.cookies?.[SESSION_COOKIE]) return res.status(401).json({ error: "Sign in first" });
  next();
}

function handle(res: Response, e: unknown) {
  if (e instanceof MfaError || e instanceof InviteError) return res.status(e.status).json({ error: e.message });
  throw e;
}

export const adminMfaRouter = Router();
adminMfaRouter.use(adminSession);

adminMfaRouter.get("/status", async (req, res) => {
  res.json(await mfaStatus(req.user!.id, req.cookies[SESSION_COOKIE]));
});

adminMfaRouter.post("/enrol/start", mfaLimiter, async (req, res) => {
  try {
    res.json(await startEnrolment(req.user!.id));
  } catch (e) {
    handle(res, e);
  }
});

adminMfaRouter.post("/enrol/confirm", mfaLimiter, async (req, res) => {
  try {
    res.json(await confirmEnrolment(req.user!.id, String(req.body?.code ?? ""), req.cookies[SESSION_COOKIE]));
  } catch (e) {
    handle(res, e);
  }
});

adminMfaRouter.post("/verify", mfaLimiter, async (req, res) => {
  try {
    const recoveryCode = typeof req.body?.recoveryCode === "string" && req.body.recoveryCode.trim() ? req.body.recoveryCode : undefined;
    res.json(await verifyForSession(req.user!.id, { code: typeof req.body?.code === "string" ? req.body.code : undefined, recoveryCode }, req.cookies[SESSION_COOKIE]));
  } catch (e) {
    handle(res, e);
  }
});

adminMfaRouter.post("/recovery-codes", mfaLimiter, async (req, res) => {
  if (mfaStale(req.user)) return res.status(403).json({ error: "Enter a fresh two-step code first", mfaReauth: true });
  try {
    res.json({ recoveryCodes: await regenerateRecoveryCodes(req.user!.id) });
  } catch (e) {
    handle(res, e);
  }
});

export const adminInviteRouter = Router();

adminInviteRouter.get("/", inviteLimiter, async (req, res) => {
  try {
    res.json(await describeInvite(String(req.query.token ?? "")));
  } catch (e) {
    handle(res, e);
  }
});

adminInviteRouter.post("/accept", inviteLimiter, async (req, res) => {
  try {
    const user = await acceptAdminInvite({ token: String(req.body?.token ?? ""), name: String(req.body?.name ?? ""), password: String(req.body?.password ?? "") });
    // Signed in, but nothing opens until two-step sign-in is set up.
    const { token } = await createSession(user.id);
    res.cookie(SESSION_COOKIE, token, cookieOpts);
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, adminRole: user.adminRole }, next: "mfa_setup" });
  } catch (e) {
    handle(res, e);
  }
});
