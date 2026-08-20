import { Router } from "express";
import { attachVendorIds, requireVendor } from "../auth.js";
import { vendorExperiencesRouter } from "./vendorExperiences.js";
import { vendorInsightsRouter } from "./vendorInsights.js";
import { vendorListingsRouter } from "./vendorListings.js";
import { vendorOperationsRouter } from "./vendorOperations.js";
import { vendorProgramsRouter } from "./vendorPrograms.js";

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

// Every sub-router below inherits req.user/req.vendorIds from the two
// .use() calls above — none of them re-applies requireVendor/attachVendorIds
// itself.
vendorRouter.use(vendorListingsRouter);
vendorRouter.use(vendorProgramsRouter);
vendorRouter.use(vendorOperationsRouter);
vendorRouter.use(vendorInsightsRouter);
vendorRouter.use(vendorExperiencesRouter);
