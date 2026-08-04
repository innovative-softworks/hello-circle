import { Router } from "express";
import { getApprovedClub, listClubs } from "../db/queries.js";

export const clubsRouter = Router();

clubsRouter.get("/", async (req, res) => {
  const county = typeof req.query.county === "string" ? req.query.county : undefined;
  const sport = typeof req.query.sport === "string" ? req.query.sport : undefined;
  res.json(await listClubs(county, sport));
});

clubsRouter.get("/:id", async (req, res) => {
  const club = await getApprovedClub(req.params.id);
  if (!club) return res.status(404).json({ error: "Club not found" });
  res.json(club);
});
