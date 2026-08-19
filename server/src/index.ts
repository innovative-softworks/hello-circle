import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachUser } from "./auth.js";
import { dataDir } from "./dataDir.js";
import { initSchema } from "./db/index.js";
import { seedAdminIfMissing, seedIfEmpty } from "./db/seed.js";
import { attachGuestEmail } from "./guestAuth.js";
import { attachResident } from "./residents.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { availabilityRouter } from "./routes/availability.js";
import { bookingsRouter } from "./routes/bookings.js";
import { centresRouter } from "./routes/centres.js";
import { circlesRouter } from "./routes/circles.js";
import { clubSessionsRouter } from "./routes/clubSessions.js";
import { clubsRouter } from "./routes/clubs.js";
import { couponsRouter } from "./routes/coupons.js";
import { discoverRouter } from "./routes/discover.js";
import { favouritesRouter } from "./routes/favourites.js";
import { feedbackRouter } from "./routes/feedback.js";
import { gamesRouter } from "./routes/games.js";
import { guestAuthRouter } from "./routes/guestAuth.js";
import { householdRouter } from "./routes/household.js";
import { orgRouter, publicInviteRouter } from "./routes/org.js";
import { passesRouter } from "./routes/passes.js";
import { programsRouter } from "./routes/programs.js";
import { reportsRouter } from "./routes/reports.js";
import { registrationsRouter } from "./routes/registrations.js";
import { residentsRouter } from "./routes/residents.js";
import { reviewsRouter } from "./routes/reviews.js";
import { searchRouter } from "./routes/search.js";
import { stripeWebhookHandler } from "./routes/stripeWebhook.js";
import { uploadsRouter } from "./routes/uploads.js";
import { vendorRouter } from "./routes/vendor.js";
import { sweepExpiredWaitlistOffers } from "./waitlist.js";

// MySQL access is async, so the schema/seed must finish before the server
// starts accepting requests — top-level await (supported by this project's
// ES2022/NodeNext TS config) blocks the rest of module evaluation until then.
await initSchema();
await seedIfEmpty();
await seedAdminIfMissing();

// A route handler throwing inside an unawaited/uncaught async path (e.g. a
// third-party API call like Stripe rejecting) would otherwise crash the
// whole process — log it and keep serving instead of taking the app down.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

// Sweeps waitlist offers whose 48h window has expired without being
// claimed, promoting the next person in line — run once at startup to
// catch anything that expired while the server was down, then every 15
// minutes. Single-instance, in-process, same rationale as rateLimit.ts's
// in-memory store: no cron infrastructure exists in this app, and this is
// the simplest thing that works at current scale.
sweepExpiredWaitlistOffers();
setInterval(sweepExpiredWaitlistOffers, 15 * 60 * 1000);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: true, credentials: true }));
// Stripe's signature check needs the exact raw body bytes, so this must be
// registered before express.json() parses (and thereby mangles) the body —
// and only for this one path, everything else still wants JSON.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.use(express.json());
app.use(cookieParser());
app.use(attachUser);
app.use(attachGuestEmail);
app.use(attachResident);
app.use("/uploads", express.static(path.join(dataDir, "uploads")));

app.use("/api/auth", authRouter);
app.use("/api/guest", guestAuthRouter);
app.use("/api/residents", residentsRouter);
app.use("/api/household", householdRouter);
app.use("/api/favourites", favouritesRouter);
app.use("/api/feedback", feedbackRouter);
app.use("/api/discover", discoverRouter);
app.use("/api/centres", centresRouter);
app.use("/api/clubs", clubsRouter);
app.use("/api/club-sessions", clubSessionsRouter);
app.use("/api/availability", availabilityRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/registrations", registrationsRouter);
app.use("/api/games", gamesRouter);
app.use("/api/circles", circlesRouter);
app.use("/api/passes", passesRouter);
app.use("/api/programs", programsRouter);
app.use("/api/vendor/org", orgRouter);
app.use("/api/invites", publicInviteRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/search", searchRouter);
app.use("/api/coupons", couponsRouter);
app.use("/api/reviews", reviewsRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/vendor", vendorRouter);
app.use("/api/admin", adminRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Serve the built React client from the same origin/process as the API —
// avoids cross-origin cookie/CORS complications for the session cookie.
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
  res.sendFile(path.join(clientDist, "index.html"));
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Hello Circle server listening on http://localhost:${port}`);
});
