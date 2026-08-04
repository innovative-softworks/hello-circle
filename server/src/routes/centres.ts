import { Router } from "express";
import { getApprovedCentre, listCentres } from "../db/queries.js";

export const centresRouter = Router();

centresRouter.get("/", async (req, res) => {
  const county = typeof req.query.county === "string" ? req.query.county : undefined;
  res.json(await listCentres(county));
});

centresRouter.get("/:id", async (req, res) => {
  const centre = await getApprovedCentre(req.params.id);
  if (!centre) return res.status(404).json({ error: "Centre not found" });
  res.json(centre);
});
