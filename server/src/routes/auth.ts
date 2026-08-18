import crypto from "node:crypto";
import { Router } from "express";
import { SESSION_COOKIE, createSession, createUser, destroySession, findUserByEmail, hashPassword, verifyPassword } from "../auth.js";
import { db } from "../db/index.js";
import { sendMail } from "../email.js";
import { magicLinkLimiter } from "../rateLimit.js";
import { CLIENT_URL } from "../stripe.js";

export const authRouter = Router();

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

authRouter.post("/signup", async (req, res) => {
  const { email, password, name, vendorType, businessName, address, county, mobile, landline, description } = req.body as {
    email?: string;
    password?: string;
    name?: string;
    vendorType?: string;
    businessName?: string;
    address?: string;
    county?: string;
    mobile?: string;
    landline?: string;
    description?: string;
  };
  if (!email || !password || !name) return res.status(400).json({ error: "Name, email and password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!vendorType || !["community", "sports"].includes(vendorType)) {
    return res.status(400).json({ error: "Please choose whether you run a community centre or a sports club" });
  }
  if (!businessName || !address || !county || !mobile || !description) {
    return res.status(400).json({ error: "Business name, address, county, mobile number and description are required" });
  }
  if (await findUserByEmail(email)) return res.status(409).json({ error: "An account with that email already exists" });

  // Public signup only ever creates vendor accounts, starting as pending
  // until an admin approves them. Admin accounts are seeded, not self-served.
  // No session is created here — the vendor has to log in themselves once
  // approved, rather than landing on an already-"logged in" header straight
  // after registering.
  //
  // A draft centre/club listing is created in the same transaction so the
  // vendor's registration is immediately visible to admin (Pending approval
  // tab/stats) and pre-fills the vendor's dashboard once approved — see
  // ListingsTab's "Setup" vs "Edit" button in VendorDashboard.tsx.
  const user = await db.transaction(async (tx) => {
    // Every vendor gets their own 1:1 organisation at signup (Phase C) —
    // matches the backfill initSchema() runs for every vendor who existed
    // before this, so org_id is never null for any vendor going forward.
    const orgId = crypto.randomUUID();
    await tx.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, ?, 'vendor')`).run(orgId, businessName);

    const user = await createUser(
      email,
      password,
      name,
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
    const listingId = crypto.randomUUID();
    if (vendorType === "community") {
      await tx.prepare(
        `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, '', ?, ?, 'pending', NOW())`
      ).run(listingId, businessName, address, county, businessName, mobile, description, user.id);
      // "Rooms" is a pure internal implementation detail (see vendor.ts) —
      // every centre gets exactly one, matching its own capacity/rate.
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

  res.status(201).json({ user });
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const found = await findUserByEmail(email);
  if (!found || !verifyPassword(password, found.passwordHash)) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }
  if (found.status === "suspended") return res.status(403).json({ error: "This account has been suspended" });

  const { token } = await createSession(found.id);
  res.cookie(SESSION_COOKIE, token, cookieOpts);
  const { passwordHash: _passwordHash, ...user } = found;
  res.json({ user });
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await destroySession(token);
  res.clearCookie(SESSION_COOKIE, cookieOpts);
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  res.json({ user: req.user ?? null });
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
      await sendMail({
        to: user.email,
        subject: "Reset your Hello Circle password",
        text: `Hi,\n\nClick the link below to set a new password:\n\n${CLIENT_URL}/reset-password?token=${token}\n\nThis link expires in 30 minutes and can only be used once. If you didn't request this, you can safely ignore it.\n\nThanks for using Hello Circle.`,
      });
    }
  }
  res.json({ ok: true });
});

// --- staff invite acceptance (Phase C) ------------------------------------

authRouter.post("/accept-invite", async (req, res) => {
  const { token, name, password } = req.body as { token?: string; name?: string; password?: string };
  if (!token || !name || !password) return res.status(400).json({ error: "Name and password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

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
    await tx.prepare(`UPDATE org_invites SET status = 'accepted' WHERE token = ?`).run(token);
    return u;
  });

  const { token: sessionToken } = await createSession(user.id);
  res.cookie(SESSION_COOKIE, sessionToken, cookieOpts);
  res.status(201).json({ user });
});

authRouter.post("/reset-password", async (req, res) => {
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
