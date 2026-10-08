import crypto from "node:crypto";
import fs from "node:fs";
import express, { type NextFunction, type Request, type Response, Router } from "express";
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

function loginPage({ next, username = "", error = false }: { next: string; username?: string; error?: boolean }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Hello Circle Staging · iSoftworks</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='11' fill='none' stroke='%231e7a4c' stroke-width='5'/%3E%3C/svg%3E">
<style>
  :root {
    --bg: #fbfaf7; --surface: #ffffff; --text: #1e2420; --muted: #5b635c; --border: #e7e4dc;
    --input: #8a857a; --green: #1e7a4c; --green-dark: #175f3b; --green-bg: #eaf4ee;
    --orange: #c74c1a; --orange-bg: #fcede4; --danger: #b00020; --danger-bg: #fbeaea;
    --display: "Bricolage Grotesque", ui-rounded, system-ui, -apple-system, "Segoe UI", sans-serif;
    --body: "Hanken Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141815; --surface: #1c211d; --text: #eef0ec; --muted: #a9b0a8; --border: #2c332d;
      --input: #6d756c; --green: #3fae76; --green-dark: #5cc28d; --green-bg: #17271e;
      --orange: #f08a5d; --orange-bg: #2c1d15; --danger: #ff8a80; --danger-bg: #2d1717;
      color-scheme: dark;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 var(--body);
         display: grid; place-items: center; padding: 24px 16px; }
  main { width: 100%; max-width: 400px; display: grid; gap: 20px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .ring { width: 40px; height: 40px; border-radius: 50%; border: 7px solid var(--green); flex: none; }
  .brand h1 { font: 700 22px/1.15 var(--display); margin: 0; letter-spacing: -0.01em; }
  .pill { display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 999px; font: 600 11px/1.6 var(--body);
          letter-spacing: .06em; text-transform: uppercase; color: var(--orange); background: var(--orange-bg); vertical-align: 3px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 28px 24px;
          display: grid; gap: 18px; box-shadow: 0 1px 2px rgba(30,36,32,.04), 0 8px 24px rgba(30,36,32,.06); }
  .card h2 { font: 600 18px/1.3 var(--display); margin: 0; }
  .card p { margin: 0; color: var(--muted); font-size: 14px; }
  label { display: grid; gap: 6px; font-size: 14px; font-weight: 600; }
  input { font: inherit; padding: 11px 12px; border-radius: 10px; border: 1px solid var(--input); background: var(--surface); color: var(--text); width: 100%; }
  input:focus { outline: 3px solid var(--green-bg); border-color: var(--green); }
  button { font: 600 16px/1 var(--body); padding: 13px 16px; border: 0; border-radius: 10px; background: var(--green); color: #fff; cursor: pointer; }
  button:hover { background: var(--green-dark); }
  button:focus-visible { outline: 3px solid var(--green-bg); outline-offset: 2px; }
  .error { padding: 10px 12px; border-radius: 10px; background: var(--danger-bg); color: var(--danger); font-size: 14px; }
  footer { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
  footer strong { color: var(--text); font-weight: 700; letter-spacing: .01em; }
</style>
</head>
<body>
<main>
  <div class="brand">
    <div class="ring" aria-hidden="true"></div>
    <h1>Hello Circle<span class="pill">Staging</span></h1>
  </div>
  <form class="card" method="post" action="/__gate/login" autocomplete="on">
    <div style="display:grid;gap:6px">
      <h2>Tester sign-in</h2>
      <p>This is the private test version of Hello Circle. Use the username and password you were given.</p>
    </div>
    ${error ? `<div class="error" role="alert">That username or password isn't right. Check for typos, or ask for a new password.</div>` : ""}
    <input type="hidden" name="next" value="${esc(next)}">
    <label for="username">Username
      <input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(username)}" ${username ? "" : "autofocus"}>
    </label>
    <label for="password">Password
      <input id="password" name="password" type="password" autocomplete="current-password" required ${username ? "autofocus" : ""}>
    </label>
    <button type="submit">Sign in</button>
  </form>
  <footer>
    <span>Test payments only · data may be reset</span>
    <span>Operated by <strong>iSoftworks</strong></span>
  </footer>
</main>
</body>
</html>`;
}
