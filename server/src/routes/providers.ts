import { Router } from "express";
import { db } from "../db/index.js";
import { orgPoliciesForVendor } from "../db/queries.js";

export const providersRouter = Router();

// Provider public profile (IA spec §5) — a dedicated page distinct from
// any one listing's own detail page, showing the vendor account behind
// possibly several listings: verified status, description, every approved
// listing they own, policies, and a contact/support pathway. Deliberately
// never exposes email/mobile/landline/password_hash — this is a public
// route, no auth required.
providersRouter.get("/:id", async (req, res) => {
  const vendor = (await db
    .prepare(`SELECT id, name, business_name as businessName, description, provider_tier as providerTier, county, status FROM users WHERE id = ? AND role = 'vendor'`)
    .get(req.params.id)) as { id: string; name: string; businessName: string; description: string; providerTier: string; county: string; status: string } | undefined;
  if (!vendor || vendor.status !== "approved") return res.status(404).json({ error: "Provider not found" });

  const centres = await db
    .prepare(`SELECT id, name, area, county, image_url as image, blurb, slug FROM centres WHERE vendor_id = ? AND status = 'approved' ORDER BY name`)
    .all(req.params.id);
  const clubs = await db
    .prepare(`SELECT id, name, sport, area, county, image_url as image, blurb, slug FROM clubs WHERE vendor_id = ? AND status = 'approved' ORDER BY name`)
    .all(req.params.id);
  const experiences = await db
    .prepare(`SELECT id, kind, title, area, county, image_url as image, blurb, slug FROM experiences WHERE vendor_id = ? AND status = 'approved' ORDER BY title`)
    .all(req.params.id);
  const policies = await orgPoliciesForVendor(req.params.id);

  res.json({
    id: vendor.id,
    name: vendor.businessName || vendor.name,
    description: vendor.description,
    verified: vendor.providerTier !== "standard",
    providerTier: vendor.providerTier,
    county: vendor.county,
    centres,
    clubs,
    experiences,
    policies,
  });
});
