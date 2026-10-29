import { Router } from "express";
import { attachVendorIds, requireVendor } from "../auth.js";
import { latestPublicDecision } from "../moderationDecisions.js";
import { canSeeObligationDetail, orgObligations } from "../orgSuspension.js";
import { vendorExperiencesRouter } from "./vendorExperiences.js";
import { vendorInsightsRouter } from "./vendorInsights.js";
import { vendorListingsRouter } from "./vendorListings.js";
import { vendorOperationsRouter } from "./vendorOperations.js";
import { vendorParticipationRouter } from "./vendorParticipation.js";
import { vendorProgramsRouter } from "./vendorPrograms.js";
import { vendorAttendeesRouter } from "./vendorAttendees.js";
import { vendorDoorRouter } from "./vendorDoor.js";

// Split from a single 1088-line file into domain sub-routers — see
// vendorListings.ts / vendorPrograms.ts / vendorOperations.ts /
// vendorInsights.ts / vendorExperiences.ts for what each covers, and
// vendorHelpers.ts for the shared ownership/scoping helpers (see CLAUDE.md
// for the rationale).

export const vendorRouter = Router();
vendorRouter.use(requireVendor);
// Populates req.vendorIds — every user id in the same organisation as the
// caller. A listing/booking/etc. counts as "yours" if its vendor_id is any
// id in that set, not just your own — this is what lets an invited staff
// member actually see/manage the owner's listings (see auth.ts orgVendorIds).
vendorRouter.use(attachVendorIds);

// D-01 — read-only view of the organisation's existing obligations, the one
// partner API allowed while the organisation is suspended (see requireVendor).
// Customer detail (first name, reference, payment state) only for the roles
// that see bookings in the workspace today; everyone else gets the schedule-
// level summary (date, listing, count). No email, phone or amounts.
vendorRouter.get("/obligations", async (req, res) => {
  const orgId = req.user!.orgId;
  if (!orgId) return res.status(403).json({ error: "No organisation" });
  const detail = canSeeObligationDetail(req.user!);
  const { items, summary } = await orgObligations(orgId, detail);
  res.json({
    orgStatus: req.user!.orgStatus ?? "active",
    decision: req.user!.orgStatus === "suspended" ? await latestPublicDecision("organisation", orgId, ["org.suspended"]) : null,
    detail,
    items,
    summary,
    support: { contact: "/contact", complaints: "/complaints" },
  });
});

// Every sub-router below inherits req.user/req.vendorIds from the two
// .use() calls above — none of them re-applies requireVendor/attachVendorIds
// itself.
vendorRouter.use(vendorListingsRouter);
vendorRouter.use(vendorProgramsRouter);
vendorRouter.use(vendorOperationsRouter);
vendorRouter.use(vendorInsightsRouter);
vendorRouter.use(vendorExperiencesRouter);
vendorRouter.use(vendorParticipationRouter);
// Participation Phase 2 — attendees, questions, check-in staff, and the door API.
vendorRouter.use(vendorAttendeesRouter);
vendorRouter.use("/door", vendorDoorRouter);
