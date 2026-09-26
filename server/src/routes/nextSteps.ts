import { Router } from "express";
import { getNextSteps, NEXT_STEPS_KINDS, type NextStepsKind } from "../nextSteps.js";

export const nextStepsRouter = Router();

// GET /api/next-steps?kind=&ref= — "keep the connection going" after any
// kind of participation (Release 3). Ownership is checked inside
// getNextSteps: the device's X-Client-Id or the signed-in resident for
// bookings/registrations/programs/experiences, participant-only for games.
// 404 (not 403) when not found or not yours, so a ref can't be probed.
nextStepsRouter.get("/", async (req, res) => {
  const kind = String(req.query.kind ?? "") as NextStepsKind;
  const ref = String(req.query.ref ?? "");
  if (!NEXT_STEPS_KINDS.includes(kind) || !ref) return res.status(400).json({ error: `kind (${NEXT_STEPS_KINDS.join("/")}) and ref are required` });
  const steps = await getNextSteps(kind, ref, req.resident?.id ?? null, req.header("X-Client-Id") ?? null);
  if (!steps) return res.status(404).json({ error: "Not found" });
  res.json(steps);
});
