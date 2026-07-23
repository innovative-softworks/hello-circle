import { Router } from "express";
import { getApprovedCentre, listCentres } from "../db/queries.js";

export const centresRouter = Router();

centresRouter.get("/", (req, res) => {
  const county = typeof req.query.county === "string" ? req.query.county : undefined;
  res.json(listCentres(county));
});

centresRouter.get("/:id", (req, res) => {
  const centre = getApprovedCentre(req.params.id);
  if (!centre) return res.status(404).json({ error: "Centre not found" });
  res.json(centre);
});
