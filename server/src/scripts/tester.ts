import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import { hashPassword } from "../auth.js";
import { db } from "../db/index.js";
import { hashGatePassword, parseGateUsers } from "../stagingGate.js";
import { TERMS_VERSION } from "../terms.js";

// Staging tester accounts: ONE username + password per tester that works on
// the staging login screen (stagingGate.ts) AND inside the app as their role.
//
//   npm run tester --workspace server -- list
//   npm run tester --workspace server -- add <name> <role> [email]
//   npm run tester --workspace server -- reset <name>
//   npm run tester --workspace server -- remove <name>
//
// Roles:
//   resident  — signs in with email + password (books, joins games, circles)
//   host      — a resident already approved as a Verified Host (can host games)
//   provider  — an approved provider account with its own organisation
//               (adds listings, which then go to admin for approval)
//   admin     — full platform admin. Give only to people you fully trust.
//
// The app account's sign-in email is `[email]` when given (the tester then
// also receives real emails), otherwise <name>@testers.hellocircle.test, a
// reserved domain that never receives mail.
//
// Refuses to run anywhere but staging: needs STAGING_GATE_USERS_FILE (which
// production never sets) and never touches a database named hello_circle.

const ROLES = ["resident", "host", "provider", "admin"] as const;
type TesterRole = (typeof ROLES)[number];

const usersFile = process.env.STAGING_GATE_USERS_FILE;
if (!usersFile || process.env.DB_NAME === "hello_circle") {
  console.error("This only runs on the staging server (STAGING_GATE_USERS_FILE must be set; production database refused).");
  process.exit(1);
}
const file: string = usersFile;

const [cmd, rawName, rawRole, rawEmail] = process.argv.slice(2);
const name = (rawName ?? "").trim().toLowerCase();
const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
const testers = parseGateUsers(text);
const lines = text.split("\n").filter((l) => l.trim());

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function save(next: string[]) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next.map((l) => l + "\n").join(""), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function needName() {
  if (!/^[a-z0-9._-]{2,32}$/.test(name)) fail("Name must be 2-32 characters: lowercase letters, digits, . _ -");
}

const newPassword = () => crypto.randomBytes(12).toString("base64url").replace(/[-_]/g, "").slice(0, 14);
const titleCase = (s: string) => s.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

async function emailInUse(email: string): Promise<boolean> {
  const user = await db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  const resident = await db.prepare(`SELECT id FROM residents WHERE email = ?`).get(email);
  return !!user || !!resident;
}

async function createAppAccount(role: TesterRole, email: string, password: string) {
  const display = titleCase(name);
  if (role === "resident" || role === "host") {
    await db
      .prepare(
        `INSERT INTO residents (id, email, name, password_hash, email_verified_at, terms_accepted_at, terms_version, marketing_consent, host_status, host_decided_at)
         VALUES (?, ?, ?, ?, NOW(), NOW(), ?, 0, ?, ?)`
      )
      .run(crypto.randomUUID(), email, display, hashPassword(password), TERMS_VERSION, role === "host" ? "verified" : "none", role === "host" ? new Date() : null);
  } else {
    const orgId = role === "provider" ? crypto.randomUUID() : null;
    if (orgId) await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, ?, 'vendor')`).run(orgId, `${display} Test Organisation`);
    await db
      .prepare(
        `INSERT INTO users (id, email, password_hash, role, status, name, vendor_type, business_name, county, org_id, terms_accepted_at, terms_version)
         VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, NOW(), ?)`
      )
      .run(
        crypto.randomUUID(),
        email,
        hashPassword(password),
        role === "admin" ? "admin" : "vendor",
        display,
        role === "provider" ? "community" : null,
        role === "provider" ? `${display} Test Organisation` : "",
        role === "provider" ? "Dublin" : "",
        orgId,
        TERMS_VERSION
      );
  }
}

async function setAppPassword(role: string, email: string, password: string) {
  const table = role === "resident" || role === "host" ? "residents" : "users";
  await db.prepare(`UPDATE ${table} SET password_hash = ? WHERE email = ?`).run(hashPassword(password), email);
}

function printCard(role: string, email: string, password: string) {
  const signIn = role === "resident" || role === "host" ? "Sign in → 'Sign in with password'" : "Provider / admin login (/login)";
  console.log(`
  ┌─ Hello Circle staging tester ─────────────────────────────
  │ 1. Open:      https://staging.hellocircle.ie
  │    Username:  ${name}
  │    Password:  ${password}
  │
  │ 2. In the app (${role}): ${signIn}
  │    Email:     ${email}
  │    Password:  (same as above)
  └────────────────────────────────────────────────────────────
  Shown only once — send it to the tester privately.
`);
}

const lineFor = async (password: string, role: string, email: string) => `${name}:${await hashGatePassword(password)}:${role}:${email}`;

switch (cmd) {
  case "list": {
    if (testers.size === 0) console.log("No testers yet.");
    else {
      console.log("Staging testers:");
      for (const [n, t] of testers) console.log(`  - ${n.padEnd(20)} ${(t.role || "login only").padEnd(10)} ${t.email}`);
    }
    break;
  }
  case "add": {
    needName();
    const role = (rawRole ?? "").trim().toLowerCase() as TesterRole;
    if (!ROLES.includes(role)) fail(`Role must be one of: ${ROLES.join(", ")}`);
    if (testers.has(name)) fail(`Tester '${name}' already exists (use reset for a new password).`);
    const email = (rawEmail ?? `${name}@testers.hellocircle.test`).trim().toLowerCase();
    if (!/^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(email)) fail("That email address doesn't look valid.");
    if (await emailInUse(email)) fail(`An app account already uses ${email}. Choose another name or email.`);
    const password = newPassword();
    await createAppAccount(role, email, password);
    save([...lines, await lineFor(password, role, email)]);
    printCard(role, email, password);
    break;
  }
  case "reset": {
    needName();
    const t = testers.get(name) ?? fail(`No tester '${name}'.`);
    const password = newPassword();
    if (t.role && t.email) await setAppPassword(t.role, t.email, password);
    save([...lines.filter((l) => !l.startsWith(`${name}:`)), await lineFor(password, t.role, t.email)]);
    printCard(t.role || "login only", t.email || "-", password);
    break;
  }
  case "remove": {
    needName();
    if (!testers.has(name)) fail(`No tester '${name}'.`);
    save(lines.filter((l) => !l.startsWith(`${name}:`)));
    console.log(`Removed '${name}' — they can no longer get past the staging login screen. (Their app account and test data are kept.)`);
    break;
  }
  default:
    fail(`Usage:
  tester list
  tester add <name> <${ROLES.join("|")}> [email]
  tester reset <name>
  tester remove <name>`);
}
process.exit(0);
