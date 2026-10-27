import { Router } from "express";
import { getSetting } from "../db/index.js";
import { paidCheckoutOpen } from "../commerce/releaseGates.js";
import { commerceSwitch } from "../commerce/switches.js";
import { circleFeatureStates, experienceFeatureStates } from "../circleFeatures.js";

// Public, non-sensitive app config the client needs before it's decided
// anything about auth/session — currently just the maps kill switch (Maps
// cost-control follow-up pass, review point #3). Deliberately its own tiny
// router rather than folded into an existing one: this must stay reachable
// with zero auth and zero dependency on any other subsystem being healthy,
// since its whole purpose is "tell the client whether to even try Mapbox."
export const configRouter = Router();

configRouter.get("/", async (_req, res) => {
  const mapsEnabled = (await getSetting("maps_enabled", "true")) !== "false";
  // Make It Happen (Open Booking) switch — lets the client hide the entry
  // points and show a "paused" state instead of a form that can only fail.
  // Display only: the make-it-happen routes refuse with 503 regardless.
  const openBooking = await commerceSwitch("commerce.open_booking");
  // Commercial release gate — lets the client say "free bookings only" up
  // front instead of failing at payment. Display only: the server refuses a
  // paid checkout regardless (checkoutService.createCheckoutSession).
  // Circle Experience 2.0 switches — display only, the Circle routes refuse
  // a switched-off feature themselves.
  const [circleFeatures, experienceFeatures] = await Promise.all([circleFeatureStates(), experienceFeatureStates()]);
  res.json({ mapsEnabled, paidCheckoutOpen: paidCheckoutOpen(), openBooking, circleFeatures, experienceFeatures });
});
