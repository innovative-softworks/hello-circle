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
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { availabilityRouter } from "./routes/availability.js";
import { bookingsRouter } from "./routes/bookings.js";
import { centresRouter } from "./routes/centres.js";
import { clubsRouter } from "./routes/clubs.js";
import { couponsRouter } from "./routes/coupons.js";
import { registrationsRouter } from "./routes/registrations.js";
import { reviewsRouter } from "./routes/reviews.js";
import { stripeWebhookHandler } from "./routes/stripeWebhook.js";
import { uploadsRouter } from "./routes/uploads.js";
import { vendorRouter } from "./routes/vendor.js";

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
app.use("/uploads", express.static(path.join(dataDir, "uploads")));

app.use("/api/auth", authRouter);
app.use("/api/centres", centresRouter);
app.use("/api/clubs", clubsRouter);
app.use("/api/availability", availabilityRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/registrations", registrationsRouter);
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
