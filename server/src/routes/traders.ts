import { Router, type Request, type Response } from "express";
import { requirePlatformRole, requireVendor } from "../auth.js";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { requireResident } from "../residents.js";
import { isValidEmail } from "../util.js";
import { requireAdminPermission } from "../adminPermissions.js";

// Revenue & Connect Stage 4 — trader profiles (DSA art. 30 traceability and
// DAC7 seller data). One profile per selling party: a vendor organisation
// ("org", edited by the owner or finance staff) or a host resident ("host").
// The TIN is never returned in full. The public view shows only the art. 30
// fields, and only after the trader has self-certified.

type Party = { type: "org" | "host"; id: string };

const PUBLIC_FIELDS = `legal_name as legalName, trading_name as tradingName, address, country, email, phone, company_number as companyNumber,
  vat_number as vatNumber, self_certified_at as selfCertifiedAt, verification_status as verificationStatus`;

const OWN_FIELDS = `${PUBLIC_FIELDS}, entity_type as entityType, tin, date_of_birth as dateOfBirth, insurance_expires_at as insuranceExpiresAt,
  verification_note as verificationNote, updated_at as updatedAt`;

const mask = (tin: string | null) => (tin ? `${"•".repeat(Math.max(0, tin.length - 4))}${tin.slice(-4)}` : null);

async function readOwn(party: Party) {
  const row = (await db.prepare(`SELECT ${OWN_FIELDS} FROM trader_profiles WHERE party_type = ? AND party_id = ?`).get(party.type, party.id)) as
    | (Record<string, unknown> & { tin: string | null })
    | undefined;
  return row ? { ...row, tin: mask(row.tin), hasTin: !!row.tin } : null;
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

async function writeOwn(req: Request, res: Response, party: Party) {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const entityType = b.entityType === "company" ? "company" : b.entityType === "individual" ? "individual" : null;
  const legalName = text(b.legalName, 200);
  const address = text(b.address, 1000);
  const country = typeof b.country === "string" && /^[A-Z]{2}$/.test(b.country) ? b.country : null;
  const email = text(b.email, 191);
  const phone = text(b.phone, 40);
  if (!entityType || !legalName || !address || !country || !email || !phone) return res.status(400).json({ error: "Entity type, legal name, address, country, email and phone are required" });
  if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email" });
  if (entityType === "company" && !text(b.companyNumber, 60)) return res.status(400).json({ error: "A company registration number is required for a company" });
  if (entityType === "individual" && !isoDate(b.dateOfBirth)) return res.status(400).json({ error: "Date of birth is required for an individual (DAC7)" });
  if (b.selfCertify !== true && b.selfCertify !== false) return res.status(400).json({ error: "Confirm (or withdraw) the self-certification" });

  // A TIN field left as the masked value (or empty) keeps the stored TIN.
  const tinIn = text(b.tin, 60);
  const keepTin = !tinIn || tinIn.includes("•");
  const existing = (await db.prepare(`SELECT self_certified_at as sc FROM trader_profiles WHERE party_type = ? AND party_id = ?`).get(party.type, party.id)) as { sc: string | null } | undefined;
  const selfCertifiedAt = b.selfCertify ? existing?.sc ?? new Date() : null;

  await db
    .prepare(
      `INSERT INTO trader_profiles (party_type, party_id, entity_type, legal_name, trading_name, address, country, email, phone, company_number, vat_number, tin, date_of_birth, insurance_expires_at, self_certified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE entity_type = VALUES(entity_type), legal_name = VALUES(legal_name), trading_name = VALUES(trading_name), address = VALUES(address),
         country = VALUES(country), email = VALUES(email), phone = VALUES(phone), company_number = VALUES(company_number), vat_number = VALUES(vat_number),
         tin = ${keepTin ? "tin" : "VALUES(tin)"}, date_of_birth = VALUES(date_of_birth), insurance_expires_at = VALUES(insurance_expires_at),
         self_certified_at = VALUES(self_certified_at),
         verification_status = IF(legal_name <=> VALUES(legal_name) AND address <=> VALUES(address) AND company_number <=> VALUES(company_number), verification_status, 'unverified')`
    )
    .run(
      party.type,
      party.id,
      entityType,
      legalName,
      text(b.tradingName, 200),
      address,
      country,
      email,
      phone,
      text(b.companyNumber, 60),
      text(b.vatNumber, 40),
      keepTin ? null : tinIn,
      entityType === "individual" ? isoDate(b.dateOfBirth) : null,
      isoDate(b.insuranceExpiresAt),
      selfCertifiedAt
    );
  await writeAudit({ actorUserId: req.user?.id ?? null, actorKind: req.user ? "user" : "resident", action: "trader_profile.updated", objectType: `trader_${party.type}`, objectId: party.id });
  res.json(await readOwn(party));
}

// Vendor organisation — owner or finance staff.
export const vendorTraderRouter = Router();
vendorTraderRouter.use(requireVendor);
const orgParty = (req: Request): Party | null => (req.user?.orgId ? { type: "org", id: req.user.orgId } : null);
vendorTraderRouter.get("/", requirePlatformRole("finance"), async (req, res) => {
  const p = orgParty(req);
  if (!p) return res.status(404).json({ error: "No organisation linked to this account" });
  res.json(await readOwn(p));
});
vendorTraderRouter.put("/", requirePlatformRole("finance"), async (req, res) => {
  const p = orgParty(req);
  if (!p) return res.status(404).json({ error: "No organisation linked to this account" });
  return writeOwn(req, res, p);
});

// Host (resident).
export const hostTraderRouter = Router();
hostTraderRouter.use(requireResident);
hostTraderRouter.get("/", async (req, res) => res.json(await readOwn({ type: "host", id: req.resident!.id })));
hostTraderRouter.put("/", async (req, res) => writeOwn(req, res, { type: "host", id: req.resident!.id }));

// Public — the seller's identity shown on a listing (DSA art. 30(7)).
export const publicTraderRouter = Router();
const LISTING_OWNER: Record<string, string> = { centre: "centres", club: "clubs", experience: "experiences" };

publicTraderRouter.get("/listing/:type/:id", async (req, res) => {
  let party: Party | null = null;
  if (req.params.type === "game") {
    const g = (await db.prepare(`SELECT host_resident_id as hostId FROM games WHERE id = ?`).get(req.params.id)) as { hostId: string } | undefined;
    if (g) party = { type: "host", id: g.hostId };
  } else if (LISTING_OWNER[req.params.type]) {
    const row = (await db
      .prepare(`SELECT u.org_id as orgId FROM ${LISTING_OWNER[req.params.type]} l JOIN users u ON u.id = l.vendor_id WHERE l.id = ? AND l.status = 'approved'`)
      .get(req.params.id)) as { orgId: string | null } | undefined;
    if (row?.orgId) party = { type: "org", id: row.orgId };
  }
  if (!party) return res.json(null);
  const t = await db.prepare(`SELECT ${PUBLIC_FIELDS} FROM trader_profiles WHERE party_type = ? AND party_id = ? AND self_certified_at IS NOT NULL`).get(party.type, party.id);
  res.json(t ?? null);
});

// Admin (legal or support) — review and verify.
export const adminTraderRouter = Router();
adminTraderRouter.get("/", requireAdminPermission("traders.view"), async (req, res) => {
  const status = typeof req.query.status === "string" && ["unverified", "verified", "rejected"].includes(req.query.status) ? req.query.status : null;
  const rows = (await db
    .prepare(`SELECT party_type as partyType, party_id as partyId, ${OWN_FIELDS} FROM trader_profiles ${status ? "WHERE verification_status = ?" : ""} ORDER BY updated_at DESC LIMIT 200`)
    .all(...(status ? [status] : []))) as (Record<string, unknown> & { tin: string | null })[];
  res.json(rows.map((r) => ({ ...r, tin: mask(r.tin), hasTin: !!r.tin })));
});

adminTraderRouter.put("/:type/:id/verification", requireAdminPermission("traders.verify"), async (req, res) => {
  const { status, note } = (req.body ?? {}) as { status?: string; note?: string };
  if (!["verified", "rejected", "unverified"].includes(status ?? "")) return res.status(400).json({ error: "Status must be verified, rejected or unverified" });
  const why = (note ?? "").trim();
  if (why.length < 5) return res.status(400).json({ error: "A note (at least 5 characters) is required — it is shown to the trader" });
  const r = await db
    .prepare(`UPDATE trader_profiles SET verification_status = ?, verification_note = ?, verified_by = ?, verified_at = NOW() WHERE party_type = ? AND party_id = ?`)
    .run(status, why.slice(0, 2000), req.user!.id, req.params.type, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: "Trader profile not found" });
  await writeAudit({ actorUserId: req.user!.id, action: "trader_profile.verification", objectType: `trader_${req.params.type}`, objectId: req.params.id, newValue: { status }, reason: why });
  res.json({ ok: true });
});
