import { Router } from "express";
import { getApprovedCentre, listCentres } from "../db/queries.js";
import { resolveRadiusFilter } from "../geo.js";

export const centresRouter = Router();

// Discovery-radius filtering (master-prompt punch list #2) — strictly
// opt-in via ?radiusKm=; see resolveRadiusFilter's own comment for the
// lat/lng-vs-county-centroid fallback order.
centresRouter.get("/", async (req, res) => {
  const county = typeof req.query.county === "string" ? req.query.county : undefined;
  const radius = resolveRadiusFilter(req.query, req.resident?.homeCounty ?? null);
  res.json(await listCentres(county, radius));
});

centresRouter.get("/:id", async (req, res) => {
  const centre = await getApprovedCentre(req.params.id);
  if (!centre) return res.status(404).json({ error: "Centre not found" });
  res.json(centre);
});
