import crypto from "node:crypto";
import { Router } from "express";
import { SESSION_COOKIE, createSession, createUser, destroySession, findUserByEmail, verifyPassword } from "../auth.js";
import { db } from "../db/index.js";

export const authRouter = Router();

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

authRouter.post("/signup", (req, res) => {
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
  if (findUserByEmail(email)) return res.status(409).json({ error: "An account with that email already exists" });

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
  const createDraft = db.transaction(() => {
    const user = createUser(email, password, name, "vendor", "pending", {
      vendorType: vendorType as "community" | "sports",
      businessName,
      address,
      county,
      mobile,
      landline: landline ?? "",
      description,
    });
    const listingId = crypto.randomUUID();
    if (vendorType === "community") {
      db.prepare(
        `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, '', ?, ?, 'pending', datetime('now'))`
      ).run(listingId, businessName, address, county, businessName, mobile, description, user.id);
      // "Rooms" is a pure internal implementation detail (see vendor.ts) —
      // every centre gets exactly one, matching its own capacity/rate.
      db.prepare(
        `INSERT INTO rooms (id, centre_id, name, cap, rate, desc, sort_order) VALUES (?, ?, '', 0, 0, '', 0)`
      ).run(crypto.randomUUID(), listingId);
    } else {
      db.prepare(
        `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, created_at)
         VALUES (?, ?, '', ?, ?, '', 0, 'year', 0, ?, '', ?, ?, 'pending', datetime('now'))`
      ).run(listingId, businessName, address, county, mobile, description, user.id);
    }
    return user;
  });

  const user = createDraft();
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
  res.clearCookie(SESSION_COOKIE, cookieOpts);
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  res.json({ user: req.user ?? null });
});
