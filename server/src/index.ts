import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
// Express 4 does not auto-catch a rejection thrown inside an async route
// handler — this patches route/middleware registration so it does, letting
// the global error handler below actually see those errors instead of the
// request hanging forever with no response. Must load before any router.
import "express-async-errors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSitemapXml, generateSitemapUrls, injectOgTags, resolveOgMeta } from "./ogMeta.js";
import { attachUser } from "./auth.js";
import { dataDir } from "./dataDir.js";
import { initSchema } from "./db/index.js";
import { seedAdminIfMissing, seedIfEmpty } from "./db/seed.js";
import { backfillSlugs } from "./slugify.js";
import { attachGuestEmail } from "./guestAuth.js";
import { attachResident } from "./residents.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { availabilityRouter } from "./routes/availability.js";
import { bookingsRouter } from "./routes/bookings.js";
import { chatRouter } from "./routes/chat.js";
import { makeItHappenRouter } from "./routes/makeItHappen.js";
import { centresRouter } from "./routes/centres.js";
import { providersRouter } from "./routes/providers.js";
import { circlesRouter } from "./routes/circles.js";
import { clubSessionsRouter } from "./routes/clubSessions.js";
import { clubsRouter } from "./routes/clubs.js";
import { couponsRouter } from "./routes/coupons.js";
import { discoverRouter } from "./routes/discover.js";
import { experiencesRouter } from "./routes/experiences.js";
import { favouritesRouter } from "./routes/favourites.js";
import { feedbackRouter } from "./routes/feedback.js";
import { followsRouter } from "./routes/follows.js";
import { geocodeRouter } from "./routes/geocode.js";
import { gamesRouter } from "./routes/games.js";
import { guestAuthRouter } from "./routes/guestAuth.js";
import { householdRouter } from "./routes/household.js";
import { manageRouter } from "./routes/manage.js";
import { orgRouter, publicInviteRouter } from "./routes/org.js";
import { participationIntentsRouter } from "./routes/participationIntents.js";
import { passesRouter } from "./routes/passes.js";
import { placeSuggestionsRouter } from "./routes/placeSuggestions.js";
import { referralsRouter } from "./routes/referrals.js";
import { programsRouter } from "./routes/programs.js";
import { reportsRouter } from "./routes/reports.js";
import { registrationsRouter } from "./routes/registrations.js";
import { residentsRouter } from "./routes/residents.js";
import { reviewsRouter } from "./routes/reviews.js";
import { searchRouter } from "./routes/search.js";
import { askRouter } from "./routes/ask.js";
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
await backfillSlugs();

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
// rateLimit.ts keys every bucket by req.ip — behind a reverse proxy/load
// balancer (the typical production deploy), that resolves to the proxy's
// own address for every request unless Express is told to trust the
// X-Forwarded-For header, collapsing every client into one shared bucket.
// Off (req.ip = the real socket address) unless ops explicitly sets
// TRUST_PROXY_HOPS to the number of trusted proxy hops in front of this
// process — trusting X-Forwarded-For by default would let any client spoof
// its own rate-limit key via that header on a deploy with no proxy at all.
if (process.env.TRUST_PROXY_HOPS) app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
// Deployment is single-origin (see CLAUDE.md), so CORS only needs to allow
// same-origin browser requests plus whatever explicit origins ops configures
// (e.g. a staging domain hitting a shared API). Reflecting any origin is a
// broader credentialed surface than a production deploy needs; when
// PUBLIC_ORIGIN(S) isn't set (local dev, where the Vite dev server on :5173
// talks to the API on :3001), fall back to reflecting the request origin.
const allowedOrigins = (process.env.PUBLIC_ORIGINS || process.env.PUBLIC_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  })
);
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
app.use("/api/manage", manageRouter);
app.use("/api/favourites", favouritesRouter);
app.use("/api/follows", followsRouter);
app.use("/api/geocode", geocodeRouter);
app.use("/api/intents", participationIntentsRouter);
app.use("/api/referrals", referralsRouter);
app.use("/api/feedback", feedbackRouter);
app.use("/api/discover", discoverRouter);
app.use("/api/centres", centresRouter);
app.use("/api/providers", providersRouter);
app.use("/api/clubs", clubsRouter);
app.use("/api/club-sessions", clubSessionsRouter);
app.use("/api/availability", availabilityRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/make-it-happen", makeItHappenRouter);
app.use("/api/chat", chatRouter);
app.use("/api/registrations", registrationsRouter);
app.use("/api/games", gamesRouter);
app.use("/api/circles", circlesRouter);
app.use("/api/passes", passesRouter);
app.use("/api/place-suggestions", placeSuggestionsRouter);
app.use("/api/programs", programsRouter);
app.use("/api/experiences", experiencesRouter);
app.use("/api/vendor/org", orgRouter);
app.use("/api/invites", publicInviteRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/search", searchRouter);
app.use("/api/ask", askRouter);
app.use("/api/coupons", couponsRouter);
app.use("/api/reviews", reviewsRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/vendor", vendorRouter);
app.use("/api/admin", adminRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// SEO basics (post-audit hardening pass) — registered before the static/
// catch-all block below, or express.static would swallow them first (no
// on-disk file at these paths) and the SPA fallback would serve index.html
// instead. Same per-request DB-query pattern ogMeta.ts already uses.
app.get("/robots.txt", (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
});

app.get("/sitemap.xml", async (req, res) => {
  try {
    const origin = `${req.protocol}://${req.get("host")}`;
    const urls = await generateSitemapUrls(origin);
    res.type("application/xml").send(buildSitemapXml(urls));
  } catch (e) {
    console.error("[sitemap] generation failed:", e instanceof Error ? e.message : e);
    res.type("application/xml").send(buildSitemapXml([]));
  }
});

// Serve the built React client from the same origin/process as the API —
// avoids cross-origin cookie/CORS complications for the session cookie.
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
const indexHtmlPath = path.join(clientDist, "index.html");
// Read once and cache in memory — the built file never changes at runtime,
// re-reading it from disk on every request would be pure waste.
let indexHtmlTemplate: string | null = null;
function readIndexHtmlTemplate(): string {
  if (indexHtmlTemplate === null) indexHtmlTemplate = fs.readFileSync(indexHtmlPath, "utf-8");
  return indexHtmlTemplate;
}

app.use(express.static(clientDist));
app.get("*", async (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();

  // Shareable link previews (master-prompt punch list #1) — only the
  // handful of public detail routes get their <head> customized; every
  // other route serves the exact same static file as before.
  try {
    const meta = await resolveOgMeta(req.path, `${req.protocol}://${req.get("host")}`);
    if (meta) {
      res.setHeader("Content-Type", "text/html");
      return res.send(injectOgTags(readIndexHtmlTemplate(), meta));
    }
  } catch (e) {
    console.error("[og-meta] lookup failed, falling back to plain index.html:", e instanceof Error ? e.message : e);
  }
  res.sendFile(indexHtmlPath);
});

// Final error handler — catches anything thrown/rejected in a route handler
// (forwarded here by express-async-errors) that wasn't already turned into a
// specific response. Never leaks a stack trace or raw DB error to the client.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[unhandled route error] ${req.method} ${req.path}:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Hello Circle server listening on http://localhost:${port}`);
});
