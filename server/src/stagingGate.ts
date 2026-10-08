import crypto from "node:crypto";
import fs from "node:fs";
import express, { type NextFunction, type Request, type Response, Router } from "express";
import { versionLabel } from "./appVersion.js";
import { simpleRateLimit } from "./rateLimit.js";

// Staging access gate — a branded username/password screen in front of the
// whole staging site, one login per tester (replaces nginx Basic Auth's
// browser pop-up). OFF unless STAGING_GATE_USERS_FILE is set, which only the
// staging server.env does; production never sets it.
//
// Users file: one `name:scrypt:<saltB64>:<hashB64>[:role[:email]]` line per
// tester, managed with `npm run tester --workspace server -- add|reset|remove|list`
// (which also creates the tester's in-app account for that role).
// It is re-read whenever it changes, so removing a tester revokes their
// access on their very next request (the session cookie names the tester).
//
// The Stripe webhook is registered before this middleware in index.ts, so
// Stripe still reaches it; /api/health and robots.txt stay open for probes.

const COOKIE = "hc_staging_gate";
const SESSION_DAYS = 14;
const LINE = /^([a-z0-9._-]{2,32}):scrypt:([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)(?::([a-z]*)(?::(\S+))?)?$/;

export async function hashGatePassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((ok, bad) => crypto.scrypt(password, salt, 32, (e, key) => (e ? bad(e) : ok(key))));
}

export interface GateUser { salt: Buffer; hash: Buffer; role: string; email: string }

export function parseGateUsers(text: string): Map<string, GateUser> {
  const users = new Map<string, GateUser>();
  for (const raw of text.split("\n")) {
    const m = LINE.exec(raw.trim());
    if (m) users.set(m[1], { salt: Buffer.from(m[2], "base64"), hash: Buffer.from(m[3], "base64"), role: m[4] ?? "", email: m[5] ?? "" });
  }
  return users;
}

export async function verifyGatePassword(entry: { salt: Buffer; hash: Buffer } | undefined, password: string): Promise<boolean> {
  // Hash even for an unknown user so response time doesn't reveal which names exist.
  const salt = entry?.salt ?? Buffer.alloc(16);
  const key = await scrypt(password, salt);
  return !!entry && entry.hash.length === key.length && crypto.timingSafeEqual(entry.hash, key);
}

export function signGateSession(name: string, expiresAt: number, secret: string): string {
  const body = `${name}.${expiresAt}`;
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function readGateSession(value: string | undefined, secret: string, now = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [name, exp, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(`${name}.${exp}`).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (!(Number(exp) > now)) return null;
  return name;
}

/** Only same-site relative paths, so the login form can't be used as an open redirect. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export function stagingGate(): Router | null {
  const file = process.env.STAGING_GATE_USERS_FILE;
  if (!file) return null;
  const secret = process.env.STAGING_GATE_SECRET ?? "";
  // Fail closed: a half-configured gate must not silently leave staging open.
  if (secret.length < 32) throw new Error("STAGING_GATE_USERS_FILE is set but STAGING_GATE_SECRET is missing or shorter than 32 characters");
  if (!fs.existsSync(file)) throw new Error(`STAGING_GATE_USERS_FILE not found: ${file}`);

  let cache = { mtimeMs: -1, users: new Map<string, GateUser>() };
  const users = () => {
    const { mtimeMs } = fs.statSync(file);
    if (mtimeMs !== cache.mtimeMs) cache = { mtimeMs, users: parseGateUsers(fs.readFileSync(file, "utf8")) };
    return cache.users;
  };
  console.log(`[staging-gate] enabled — ${users().size} tester login(s)`);

  const secure = process.env.NODE_ENV === "production";
  const router = Router();
  const loginLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

  router.get("/__gate/login", (req, res) => {
    res.set("Cache-Control", "no-store").type("html").send(loginPage({ next: safeNext(req.query.next) }));
  });

  router.post("/__gate/login", loginLimiter, express.urlencoded({ extended: false, limit: "4kb" }), async (req, res) => {
    const name = String(req.body?.username ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const next = safeNext(req.body?.next);
    if (!(await verifyGatePassword(users().get(name), password))) {
      console.warn(`[staging-gate] failed login for "${name.slice(0, 32)}"`);
      return res.status(401).set("Cache-Control", "no-store").type("html").send(loginPage({ next, username: name, error: true }));
    }
    const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
    res.cookie(COOKIE, signGateSession(name, expiresAt, secret), { httpOnly: true, secure, sameSite: "lax", path: "/", expires: new Date(expiresAt) });
    console.log(`[staging-gate] login: ${name}`);
    res.redirect(303, next);
  });

  router.get("/__gate/logout", (_req, res) => {
    res.clearCookie(COOKIE, { path: "/" });
    res.redirect(303, "/__gate/login");
  });

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/api/health" || req.path === "/robots.txt") return next();
    const name = readGateSession(req.cookies?.[COOKIE], secret);
    if (name && users().has(name)) return next();
    if (req.path.startsWith("/api/") || req.method !== "GET") {
      return res.status(401).json({ error: "Staging access required — sign in at /__gate/login" });
    }
    res.redirect(302, `/__gate/login?next=${encodeURIComponent(req.originalUrl)}`);
  });

  return router;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// iSoftworks wordmark + mark, from isoftworks.eu's logo.svg (recoloured via currentColor).
const ISW_LOGO = `<svg class="isw" xmlns="http://www.w3.org/2000/svg" viewBox="30 30 760 140" fill="currentColor" role="img" aria-label="iSoftworks"><polygon points="83.4 161 83.4 41.5 103.4 55.8 103.4 141.9 83.4 161"/><polygon points="103.4 161 103.4 41.5 123.4 55.8 123.4 141.9 103.4 161"/><polygon points="44 161 83.4 161 83.4 121.6 44 161"/><path d="M83.3,121.1h0s0,.5,0,.5V41.5h0c-21.8.3-39.3,18-39.3,39.8s17.6,39.5,39.3,39.8Z"/><path d="M123.7,81.4h0s0-.5,0-.5l39.4-39.4h-39.6v119.5h.3c21.8-.3,39.3-18,39.3-39.8s-17.6-39.5-39.3-39.8"/><path d="M213.3,70.4c-2.3,0-4.2-.6-5.7-1.8-1.5-1.2-2.2-2.9-2.2-5s.7-3.8,2.2-5c1.5-1.2,3.4-1.8,5.7-1.8s4.2.6,5.7,1.8c1.5,1.2,2.2,2.9,2.2,5s-.7,3.7-2.2,5c-1.5,1.2-3.4,1.8-5.7,1.8ZM206.1,137.8v-59.4h14.3v59.4h-14.3Z"/><path d="M264.3,138.8c-7.5,0-13.8-1.1-18.8-3.3-5-2.2-8.8-5.4-11.3-9.4-2.5-4-3.8-8.6-3.9-13.7h15.5c0,3.1.8,5.7,2.1,7.9,1.3,2.2,3.4,4,6.1,5.2,2.8,1.3,6.3,1.9,10.7,1.9s6.6-.4,9.2-1.2c2.6-.8,4.6-2.1,6-3.8,1.4-1.7,2.1-4,2.1-6.6s-.3-3.8-1-5.2c-.7-1.4-1.8-2.5-3.4-3.5-1.6-.9-3.7-1.7-6.4-2.4-2.7-.7-6-1.3-9.9-2-4.8-.7-9-1.7-12.7-3-3.6-1.2-6.7-2.7-9.1-4.5-2.4-1.8-4.3-4-5.5-6.5-1.2-2.6-1.8-5.6-1.8-9.2s1.3-9.1,3.8-12.7c2.6-3.6,6.2-6.3,11-8.3,4.7-2,10.4-3,17-3s12.1,1,16.7,3c4.6,2,8.2,4.8,10.7,8.4,2.5,3.6,3.8,7.8,3.9,12.6h-15.4c0-2.9-.8-5.3-2.3-7.2s-3.4-3.3-5.9-4.2c-2.5-.9-5.2-1.3-8.4-1.3s-6,.4-8.3,1.3c-2.3.9-4.1,2.1-5.3,3.7-1.2,1.6-1.8,3.6-1.8,5.9s.6,4.5,1.9,6c1.3,1.5,3.4,2.6,6.5,3.5,3.1.9,7.4,1.8,12.8,2.7,3.7.6,7.2,1.3,10.6,2.2,3.4.9,6.4,2.2,9.2,4s4.9,4.1,6.5,7.1c1.6,3,2.4,6.9,2.4,11.7s-1.3,9-3.8,12.6c-2.5,3.6-6.3,6.5-11.2,8.5-5,2-11.1,3-18.5,3Z"/><path d="M336.1,138.8c-4.6,0-8.7-.7-12.4-2.1-3.7-1.4-6.9-3.4-9.6-6.1-2.7-2.7-4.8-5.9-6.2-9.7-1.4-3.8-2.1-8.1-2.1-12.8s1.2-11.5,3.6-16.1c2.4-4.6,5.9-8.2,10.4-10.8,4.5-2.6,9.9-3.9,16.3-3.9s8.6.7,12.3,2.1c3.7,1.4,6.8,3.5,9.5,6.1,2.6,2.7,4.7,5.9,6.1,9.7,1.5,3.8,2.2,8.1,2.2,12.9s-1.2,11.3-3.6,16c-2.4,4.6-5.9,8.2-10.3,10.8-4.5,2.6-9.9,3.9-16.1,3.9ZM336,127.3c3.1,0,5.9-.7,8.3-2.2,2.4-1.5,4.2-3.6,5.5-6.5,1.3-2.9,2-6.4,2-10.5s-.4-5.9-1.1-8.3c-.7-2.4-1.8-4.4-3.2-6.1-1.4-1.6-3-2.9-4.9-3.7-1.9-.8-4.1-1.2-6.4-1.2s-5.9.7-8.3,2.2c-2.4,1.5-4.3,3.6-5.6,6.5-1.3,2.9-2,6.4-2,10.7s.4,5.9,1.1,8.3c.7,2.4,1.8,4.4,3.2,6,1.4,1.6,3,2.8,5,3.6,2,.8,4.1,1.2,6.5,1.2Z"/><path d="M379.1,137.8v-48.2h-9.6v-11.3h9.6v-7.4c0-4.8,1.5-8.4,4.4-10.8,2.9-2.5,7.1-3.7,12.4-3.7h10.6v9.8h-7c-2.2,0-3.8.5-4.7,1.5-.9,1-1.4,2.4-1.4,4.2v6.4h12v11.3h-12v48.2h-14.3Z"/><path d="M434,137.8c-4.9,0-8.6-1.1-11-3.4-2.4-2.3-3.6-5.9-3.6-10.9v-33.8h-11.2v-11.3h11.2v-16.7l14.3-1.5v18.2h12.9v11.3h-12.9v31.2c0,2,.5,3.4,1.4,4.2,1,.8,2.3,1.2,4.2,1.2h7.3v11.5h-12.7Z"/><path d="M465.5,137.8l-14.9-59.4h14.7l7.3,31.6,3.1,15.4h.7l2.8-15.4,6.7-31.6h16.2l6.8,31.6,2.8,15.5h.7l3-15.5,7.5-31.6h14l-14.9,59.4h-18.8l-6.4-27.8-2.9-15.6h-.6l-2.8,15.6-6,27.8h-18.8Z"/><path d="M569.8,138.8c-4.6,0-8.7-.7-12.4-2.1-3.7-1.4-6.9-3.4-9.6-6.1-2.7-2.7-4.8-5.9-6.2-9.7-1.4-3.8-2.1-8.1-2.1-12.8s1.2-11.5,3.6-16.1c2.4-4.6,5.9-8.2,10.4-10.8,4.5-2.6,9.9-3.9,16.3-3.9s8.6.7,12.3,2.1c3.7,1.4,6.8,3.5,9.5,6.1,2.6,2.7,4.7,5.9,6.1,9.7,1.5,3.8,2.2,8.1,2.2,12.9s-1.2,11.3-3.6,16c-2.4,4.6-5.9,8.2-10.3,10.8-4.5,2.6-9.9,3.9-16.1,3.9ZM569.7,127.3c3.1,0,5.9-.7,8.3-2.2,2.4-1.5,4.2-3.6,5.5-6.5,1.3-2.9,2-6.4,2-10.5s-.4-5.9-1.1-8.3c-.7-2.4-1.8-4.4-3.2-6.1-1.4-1.6-3-2.9-4.9-3.7-1.9-.8-4.1-1.2-6.4-1.2s-5.9.7-8.3,2.2c-2.4,1.5-4.3,3.6-5.6,6.5-1.3,2.9-2,6.4-2,10.7s.4,5.9,1.1,8.3c.7,2.4,1.8,4.4,3.2,6,1.4,1.6,3,2.8,5,3.6,2,.8,4.1,1.2,6.5,1.2Z"/><path d="M609.5,137.8v-59.4h13l.7,9.9h.5c1.4-3.8,3.6-6.5,6.7-8.2,3.1-1.7,6.6-2.5,10.6-2.5h3.6v13.2c-.5,0-1,0-1.7,0-.7,0-1.4,0-2.1,0-3.7,0-6.7.6-9.2,1.7-2.4,1.2-4.3,2.8-5.6,5-1.3,2.2-2,4.8-2.1,7.9v32.5h-14.3Z"/><path d="M652.2,137.8V56.5l14.6-3.5v51.9l5.2-5.7,20.4-20.8h17.8l-23.6,23.3,24.2,36h-16.9l-13.8-20.6-3.7-6.1-9.6,9.3v17.5h-14.6Z"/><path d="M739.1,139c-4.1,0-7.7-.5-10.8-1.4-3.2-.9-5.9-2.2-8.1-3.9-2.3-1.7-4-3.7-5.3-6-1.3-2.3-1.9-5-2-7.9h14.1c.2,2.2.9,3.9,1.9,5.2,1.1,1.3,2.5,2.3,4.3,3,1.8.6,3.9,1,6.3,1,3.7,0,6.4-.7,8.3-2,1.9-1.3,2.8-3.1,2.8-5.4s-.4-3.3-1.3-4.3c-.9-1-2.3-1.8-4.1-2.3-1.9-.6-4.4-1.1-7.5-1.5-5.2-.7-9.5-1.8-13-3.1s-6-3.1-7.7-5.4c-1.7-2.3-2.5-5.4-2.5-9.1s1-7,3.2-9.7c2.1-2.8,5-4.9,8.8-6.4,3.7-1.5,8.1-2.3,13.1-2.3s9.1.7,12.7,2.2c3.6,1.5,6.4,3.6,8.4,6.4,2,2.8,3.1,6,3.3,9.6h-14.1c0-1.9-.5-3.5-1.4-4.7-1-1.2-2.2-2.1-3.8-2.7-1.6-.6-3.4-.9-5.5-.9-3.2,0-5.7.7-7.6,2-1.8,1.3-2.8,3.1-2.8,5.3s.5,3,1.4,4c1,1,2.5,1.8,4.6,2.4,2.1.6,4.9,1.1,8.3,1.6,4.9.7,9,1.6,12.2,2.9,3.3,1.3,5.7,3.1,7.3,5.5,1.6,2.4,2.5,5.5,2.5,9.5s-1.1,7.3-3.3,10.1c-2.2,2.8-5.2,4.9-9.1,6.4-3.9,1.5-8.5,2.2-13.7,2.2Z"/></svg>`;

// Hello Circle symbol (client/public/illustrations/Fav.svg), recoloured via fill.
const HC_SYMBOL = `<svg class="hc" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 62.24 62.24" aria-hidden="true"><path d="Layer_2"/><path d="Layer_1-2"/><path d="M17.68,40.76c.39-.39.39-1.01,0-1.4l-3.07-3.07c-2.27-2.46-5.11-4.3-8.22-5.44-.68-.25-.86-1.11-.36-1.62l6.56-6.56c.51-.51,1.37-.32,1.62.36,1.15,3.12,2.96,5.97,5.33,8.34l3.07,3.07c.39.39,1.01.39,1.4,0l10.03-10.03c.39-.39.39-1.01,0-1.4l-3.07-3.07c-2.26-2.46-5.11-4.3-8.22-5.44-.68-.25-.86-1.11-.36-1.62l6.58-6.58c.51-.51,1.36-.32,1.62.35,1.17,3.1,2.99,5.96,5.36,8.32l3.07,3.07c.39.39,1.01.39,1.4,0l9.86-9.86c.39-.39.39-1.01,0-1.4l-.79-.79s-.08-.07-.13-.11C37.18-2.92,20.08-1.85,9.11,9.11-2.13,20.36-2.97,38.07,6.6,50.28c.37.47,1.06.51,1.48.09l9.61-9.61Z"/><path d="M56.24,12.77h0c-.39-.39-1.01-.39-1.4,0l-9.86,9.86c-.39.39-.39,1.01,0,1.4l2.28,2.28c2.37,2.37,5.21,4.16,8.33,5.35.67.25.85,1.11.35,1.62l-6.59,6.59c-.51.51-1.37.32-1.62-.35-1.17-3.14-2.97-5.96-5.44-8.23l-2.28-2.28c-.39-.39-1.01-.39-1.4,0l-10.03,10.03c-.39.39-.39,1.01,0,1.4l2.28,2.28c2.37,2.37,5.2,4.16,8.35,5.32.67.25.86,1.11.35,1.62l-6.57,6.57c-.51.51-1.37.32-1.62-.35-1.17-3.14-2.97-5.96-5.44-8.23l-2.28-2.28c-.39-.39-1.01-.39-1.4,0l-9.49,9.49c-.43.43-.37,1.14.12,1.5,12.17,8.82,29.27,7.75,40.24-3.22,10.96-10.96,12.04-28.07,3.22-40.23-.03-.04-.07-.09-.11-.13Z"/></svg>`;

// Very faint repeating Hello Circle symbol behind the page.
const HC_PATTERN = "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22160%22%20height=%22160%22%20viewBox=%220%200%20160%20160%22%3E%3Cg%20fill=%22%23111729%22%20fill-opacity=%22.028%22%3E%3Cg%20transform=%22translate%2818%2018%29%20scale%28.7%29%22%3E%3Cpath%20d=%22Layer_2%22/%3E%3Cpath%20d=%22Layer_1-2%22/%3E%3Cpath%20d=%22M17.68,40.76c.39-.39.39-1.01,0-1.4l-3.07-3.07c-2.27-2.46-5.11-4.3-8.22-5.44-.68-.25-.86-1.11-.36-1.62l6.56-6.56c.51-.51,1.37-.32,1.62.36,1.15,3.12,2.96,5.97,5.33,8.34l3.07,3.07c.39.39,1.01.39,1.4,0l10.03-10.03c.39-.39.39-1.01,0-1.4l-3.07-3.07c-2.26-2.46-5.11-4.3-8.22-5.44-.68-.25-.86-1.11-.36-1.62l6.58-6.58c.51-.51,1.36-.32,1.62.35,1.17,3.1,2.99,5.96,5.36,8.32l3.07,3.07c.39.39,1.01.39,1.4,0l9.86-9.86c.39-.39.39-1.01,0-1.4l-.79-.79s-.08-.07-.13-.11C37.18-2.92,20.08-1.85,9.11,9.11-2.13,20.36-2.97,38.07,6.6,50.28c.37.47,1.06.51,1.48.09l9.61-9.61Z%22/%3E%3Cpath%20d=%22M56.24,12.77h0c-.39-.39-1.01-.39-1.4,0l-9.86,9.86c-.39.39-.39,1.01,0,1.4l2.28,2.28c2.37,2.37,5.21,4.16,8.33,5.35.67.25.85,1.11.35,1.62l-6.59,6.59c-.51.51-1.37.32-1.62-.35-1.17-3.14-2.97-5.96-5.44-8.23l-2.28-2.28c-.39-.39-1.01-.39-1.4,0l-10.03,10.03c-.39.39-.39,1.01,0,1.4l2.28,2.28c2.37,2.37,5.2,4.16,8.35,5.32.67.25.86,1.11.35,1.62l-6.57,6.57c-.51.51-1.37.32-1.62-.35-1.17-3.14-2.97-5.96-5.44-8.23l-2.28-2.28c-.39-.39-1.01-.39-1.4,0l-9.49,9.49c-.43.43-.37,1.14.12,1.5,12.17,8.82,29.27,7.75,40.24-3.22,10.96-10.96,12.04-28.07,3.22-40.23-.03-.04-.07-.09-.11-.13Z%22/%3E%3C/g%3E%3Cg%20transform=%22translate%2898%2098%29%20scale%28.7%29%20rotate%2890%2031.12%2031.12%29%22%3E%3Cpath%20d=%22Layer_2%22/%3E%3Cpath%20d=%22Layer_1-2%22/%3E%3Cpath%20d=%22M17.68,40.76c.39-.39.39-1.01,0-1.4l-3.07-3.07c-2.27-2.46-5.11-4.3-8.22-5.44-.68-.25-.86-1.11-.36-1.62l6.56-6.56c.51-.51,1.37-.32,1.62.36,1.15,3.12,2.96,5.97,5.33,8.34l3.07,3.07c.39.39,1.01.39,1.4,0l10.03-10.03c.39-.39.39-1.01,0-1.4l-3.07-3.07c-2.26-2.46-5.11-4.3-8.22-5.44-.68-.25-.86-1.11-.36-1.62l6.58-6.58c.51-.51,1.36-.32,1.62.35,1.17,3.1,2.99,5.96,5.36,8.32l3.07,3.07c.39.39,1.01.39,1.4,0l9.86-9.86c.39-.39.39-1.01,0-1.4l-.79-.79s-.08-.07-.13-.11C37.18-2.92,20.08-1.85,9.11,9.11-2.13,20.36-2.97,38.07,6.6,50.28c.37.47,1.06.51,1.48.09l9.61-9.61Z%22/%3E%3Cpath%20d=%22M56.24,12.77h0c-.39-.39-1.01-.39-1.4,0l-9.86,9.86c-.39.39-.39,1.01,0,1.4l2.28,2.28c2.37,2.37,5.21,4.16,8.33,5.35.67.25.85,1.11.35,1.62l-6.59,6.59c-.51.51-1.37.32-1.62-.35-1.17-3.14-2.97-5.96-5.44-8.23l-2.28-2.28c-.39-.39-1.01-.39-1.4,0l-10.03,10.03c-.39.39-.39,1.01,0,1.4l2.28,2.28c2.37,2.37,5.2,4.16,8.35,5.32.67.25.86,1.11.35,1.62l-6.57,6.57c-.51.51-1.37.32-1.62-.35-1.17-3.14-2.97-5.96-5.44-8.23l-2.28-2.28c-.39-.39-1.01-.39-1.4,0l-9.49,9.49c-.43.43-.37,1.14.12,1.5,12.17,8.82,29.27,7.75,40.24-3.22,10.96-10.96,12.04-28.07,3.22-40.23-.03-.04-.07-.09-.11-.13Z%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E";

// Design "B, iSoftworks portal" on a light, patterned ground: iSoftworks
// leads at the top, a short introduction says what Hello Circle is, the card
// names it as the product being entered, and the footer shows the iSoftworks
// product family plus the running version/build.
function loginPage({ next, username = "", error = false }: { next: string; username?: string; error?: boolean }): string {
  const version = versionLabel();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Hello Circle staging · iSoftworks</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2062.24%2062.24%22%20fill=%22%23ee4826%22%3E%3Cpath%20d=%22Layer_2%22/%3E%3Cpath%20d=%22Layer_1-2%22/%3E%3Cpath%20d=%22M17.68,40.76c.39-.39.39-1.01,0-1.4l-3.07-3.07c-2.27-2.46-5.11-4.3-8.22-5.44-.68-.25-.86-1.11-.36-1.62l6.56-6.56c.51-.51,1.37-.32,1.62.36,1.15,3.12,2.96,5.97,5.33,8.34l3.07,3.07c.39.39,1.01.39,1.4,0l10.03-10.03c.39-.39.39-1.01,0-1.4l-3.07-3.07c-2.26-2.46-5.11-4.3-8.22-5.44-.68-.25-.86-1.11-.36-1.62l6.58-6.58c.51-.51,1.36-.32,1.62.35,1.17,3.1,2.99,5.96,5.36,8.32l3.07,3.07c.39.39,1.01.39,1.4,0l9.86-9.86c.39-.39.39-1.01,0-1.4l-.79-.79s-.08-.07-.13-.11C37.18-2.92,20.08-1.85,9.11,9.11-2.13,20.36-2.97,38.07,6.6,50.28c.37.47,1.06.51,1.48.09l9.61-9.61Z%22/%3E%3Cpath%20d=%22M56.24,12.77h0c-.39-.39-1.01-.39-1.4,0l-9.86,9.86c-.39.39-.39,1.01,0,1.4l2.28,2.28c2.37,2.37,5.21,4.16,8.33,5.35.67.25.85,1.11.35,1.62l-6.59,6.59c-.51.51-1.37.32-1.62-.35-1.17-3.14-2.97-5.96-5.44-8.23l-2.28-2.28c-.39-.39-1.01-.39-1.4,0l-10.03,10.03c-.39.39-.39,1.01,0,1.4l2.28,2.28c2.37,2.37,5.2,4.16,8.35,5.32.67.25.86,1.11.35,1.62l-6.57,6.57c-.51.51-1.37.32-1.62-.35-1.17-3.14-2.97-5.96-5.44-8.23l-2.28-2.28c-.39-.39-1.01-.39-1.4,0l-9.49,9.49c-.43.43-.37,1.14.12,1.5,12.17,8.82,29.27,7.75,40.24-3.22,10.96-10.96,12.04-28.07,3.22-40.23-.03-.04-.07-.09-.11-.13Z%22/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Mona+Sans:wght@400;500;600;700&family=Unbounded:wght@600;700&display=swap">
<style>
  :root {
    --navy: #111729; --violet: #7135E5; --orange: #FD4B23; --hc: #ee4826; --hc-bg: #fdece7;
    --ground: #F6F5F3; --ink: #111729; --soft: #555a6b; --line: #e6e4ee; --field: #b9bccb; --card: #ffffff;
    --danger: #b00020; --danger-bg: #fdecee;
    --display: "Unbounded", "Mona Sans", system-ui, sans-serif;
    --body: "Mona Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--ink); font: 15px/1.55 var(--body); background: var(--ground) url("${HC_PATTERN}") repeat;
         display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; }
  .top { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: calc(20px + env(safe-area-inset-top, 0px)) 28px 12px; }
  .isw { width: 128px; height: auto; color: var(--navy); display: block; }
  .stg { font: 700 10px/1 var(--body); letter-spacing: .14em; text-transform: uppercase; padding: 6px 10px; border-radius: 999px; color: #c23310; background: #FFE6DF; }
  main { flex: 1; width: 100%; padding: 24px 28px 32px;
         display: grid; grid-template-columns: minmax(0, 600px) minmax(0, 420px); justify-content: space-between; gap: 56px; align-items: center; }
  .about { display: grid; gap: 18px; min-width: 0; }
  .eyebrow { font: 600 11px/1 var(--body); letter-spacing: .16em; text-transform: uppercase; color: var(--violet); }
  .about h1 { margin: 0; font: 700 clamp(30px, 4.2vw, 44px)/1.05 var(--display); letter-spacing: -.02em; }
  .lead { margin: 0; font-size: 17px; color: #2c3142; max-width: 46ch; }
  .points { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .points li { display: grid; grid-template-columns: 20px 1fr; gap: 10px; align-items: baseline; }
  .points li::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--hc); transform: translate(5px, -1px); }
  .points b { font-weight: 600; }
  .note { margin: 0; font-size: 13px; color: var(--soft); border-left: 3px solid var(--orange); padding-left: 12px; max-width: 46ch; }
  form { width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 26px; display: grid; gap: 18px;
         box-shadow: 0 1px 2px rgba(17,23,41,.04), 0 18px 44px rgba(17,23,41,.08); }
  .prod { display: flex; gap: 14px; align-items: center; padding-bottom: 18px; border-bottom: 1px solid #efeef3; }
  .tile { width: 52px; height: 52px; border-radius: 14px; background: var(--hc-bg); display: grid; place-items: center; flex: none; }
  .tile .hc { width: 30px; height: 30px; fill: var(--hc); }
  .name { font: 700 19px/1.15 var(--display); letter-spacing: -.01em; }
  .by { font-size: 13px; color: var(--soft); }
  .by b { color: var(--violet); font-weight: 600; }
  label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
  input { font: inherit; font-size: 16px; padding: 12px; border-radius: 10px; border: 1px solid var(--field); background: #fff; color: var(--ink); width: 100%; }
  input:focus { outline: 3px solid rgba(113,53,229,.22); border-color: var(--violet); }
  button { font: 600 15px/1 var(--body); padding: 14px 16px; border: 0; border-radius: 10px; background: var(--navy); color: #fff; cursor: pointer; }
  button:hover { background: var(--violet); }
  button:focus-visible { outline: 3px solid rgba(253,75,35,.5); outline-offset: 2px; }
  .error { padding: 10px 12px; border-radius: 10px; background: var(--danger-bg); color: var(--danger); font-size: 14px; }
  .help { margin: -4px 0 0; font-size: 13px; color: var(--soft); text-align: center; }
  footer { display: flex; justify-content: space-between; align-items: center; gap: 12px 20px; flex-wrap: wrap;
           width: 100%; padding: 16px 28px calc(22px + env(safe-area-inset-bottom, 0px));
           font-size: 12px; color: var(--soft); border-top: 1px solid var(--line); }
  .family { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .family .lbl { font-weight: 600; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; }
  .pp { padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); background: #fff; color: var(--soft); }
  .pp.on { border-color: var(--hc); color: #b8321a; background: var(--hc-bg); font-weight: 600; }
  .ver { font-variant-numeric: tabular-nums; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11.5px; }
  @media (max-width: 860px) {
    main { grid-template-columns: 1fr; gap: 28px; padding: 12px 16px 28px; }
    form { order: -1; }
    .about { gap: 14px; }
    .about h1 { font-size: 26px; }
    .lead { font-size: 15px; }
    .top, footer { padding-inline: 16px; }
    .isw { width: 112px; }
  }
  @media (prefers-reduced-motion: no-preference) { button { transition: background .15s ease; } }
</style>
</head>
<body>
<header class="top">
  ${ISW_LOGO}
  <span class="stg">Staging</span>
</header>
<main>
  <section class="about" aria-labelledby="about-title">
    <span class="eyebrow">An iSoftworks product</span>
    <h1 id="about-title">Hello Circle</h1>
    <p class="lead">One place for Ireland's community centres, sports clubs and local activity. People find what's on near them, book a hall or a session, join a game or a circle, and pay online.</p>
    <ul class="points">
      <li><span><b>Residents</b> book rooms, register kids for clubs and join games and circles.</span></li>
      <li><span><b>Venues and clubs</b> manage listings, bookings, sessions, staff and payments.</span></li>
      <li><span><b>Hosts and organisers</b> run their own games and recurring circles.</span></li>
    </ul>
    <p class="note">You're signing in to the staging version. Payments use Stripe test mode, so no real money moves, and data may be reset at any time.</p>
  </section>
  <form method="post" action="/__gate/login" autocomplete="on">
    <div class="prod">
      <div class="tile">${HC_SYMBOL}</div>
      <div><div class="name">Tester sign-in</div><div class="by">Test environment · by <b>iSoftworks</b></div></div>
    </div>
    ${error ? `<div class="error" role="alert">That username or password isn't right. Check for typos, or ask the iSoftworks team for a new password.</div>` : ""}
    <input type="hidden" name="next" value="${esc(next)}">
    <label for="username">Username
      <input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(username)}" ${username ? "" : "autofocus"}>
    </label>
    <label for="password">Password
      <input id="password" name="password" type="password" autocomplete="current-password" required ${username ? "autofocus" : ""}>
    </label>
    <button type="submit">Sign in to Hello Circle</button>
    <p class="help">Need access? Ask the iSoftworks team.</p>
  </form>
</main>
<footer>
  <div class="family"><span class="lbl">iSoftworks products</span><span class="pp on">Hello Circle</span></div>
  ${version ? `<span class="ver" title="Release version and code build running on staging">${esc(version)}</span>` : ""}
</footer>
</body>
</html>`;
}
