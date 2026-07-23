import { Router } from "express";
import { SESSION_COOKIE, createSession, createUser, destroySession, findUserByEmail, verifyPassword } from "../auth.js";

export const authRouter = Router();

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

authRouter.post("/signup", (req, res) => {
  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
  if (!email || !password || !name) return res.status(400).json({ error: "Name, email and password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (findUserByEmail(email)) return res.status(409).json({ error: "An account with that email already exists" });

  // Public signup only ever creates vendor accounts, starting as pending
  // until an admin approves them. Admin accounts are seeded, not self-served.
  const user = createUser(email, password, name, "vendor", "pending");
  const { token } = createSession(user.id);
  res.cookie(SESSION_COOKIE, token, cookieOpts);
  res.status(201).json({ user });
});

authRouter.post("/login", (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const found = findUserByEmail(email);
  if (!found || !verifyPassword(password, found.passwordHash)) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }
  if (found.status === "suspended") return res.status(403).json({ error: "This account has been suspended" });

  const { token } = createSession(found.id);
  res.cookie(SESSION_COOKIE, token, cookieOpts);
  const { passwordHash: _passwordHash, ...user } = found;
  res.json({ user });
});

authRouter.post("/logout", (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) destroySession(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  res.json({ user: req.user ?? null });
});
