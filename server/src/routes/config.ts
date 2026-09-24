import { Router } from "express";
import { getSetting } from "../db/index.js";

// Public, non-sensitive app config the client needs before it's decided
// anything about auth/session — currently just the maps kill switch (Maps
// cost-control follow-up pass, review point #3). Deliberately its own tiny
// router rather than folded into an existing one: this must stay reachable
// with zero auth and zero dependency on any other subsystem being healthy,
// since its whole purpose is "tell the client whether to even try Mapbox."
export const configRouter = Router();

configRouter.get("/", async (_req, res) => {
  const mapsEnabled = (await getSetting("maps_enabled", "true")) !== "false";
  res.json({ mapsEnabled });
});
