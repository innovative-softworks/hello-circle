import { FORM_REQUIRED } from "../participation/formAnswers.js";
import { taxonomyFields, taxonomyFilter } from "../taxonomy.js";
import { businessCheckedSql } from "../verification.js";
import { withCardLabels } from "../categoryLabels.js";
import { customerPaymentCase } from "../payments/paymentReview.js";
import { sweepSpotAlerts } from "../spotAlerts.js";
import { Router } from "express";
import { paymentUnderReview } from "../payments/checkoutAgreement.js";
import { allocate } from "../commerce/money.js";
import { creditBalance, creditForCheckout, reserveCredit } from "../commerce/credits.js";
import { commerceQuoteLimiter } from "../rateLimit.js";
import { createCheckoutSession, pricingLineItems } from "../checkoutService.js";
import { logEvent, logView } from "../analytics.js";
import { db } from "../db/index.js";
import { getListingAttributes, officialCircleSummary } from "../listingAttributes.js";
import { orgPoliciesForVendor } from "../db/queries.js";
import { upgradeFavouriteStatus } from "./favourites.js";
import { buildIcsEvent } from "../ics.js";
import { irelandWallTimeToUtc } from "../irelandTime.js";
import { cancelDeadlineIso, experienceCancelBlock, refundStateOf } from "../selfCancel.js";
import { cleanParticipantNames, minAgeError, recordOrderAcknowledgements, recordParticipantNames } from "../orderAcknowledgements.js";
import { notifyAnswersChanged, notifyCancellation, notifyNewBookingOrRegistration } from "../notifications.js";
import { computePricing, evaluateCoupon } from "../pricing.js";
import { QuoteError, consumeQuote, createOrder, createQuote, engineEnabledFor, engineLineItems, legacyColumns, priceWithRules, releaseQuote, shadowPrice, syncOrderFromSource, vendorPartner } from "../commerce/engine.js";
import { BadRequestError, ConflictError, clientIdFrom, generateRef, isValidEmail } from "../util.js";
import { VENDOR_SUSPENDED_ERROR, consumeCoupon, customerKeyOf, endPendingHold, isPositiveInt, occupiesCapacitySql, startIsInFuture } from "../bookingIntegrity.js";
import { assertSellable, offeringSellable, orgActiveSql, unavailableListing } from "../orgStatus.js";
import { activeOptions, attendeesOn, listingUsesOptions, onSale, partialCancelOn, participationEventsOn, participationOptionsOn } from "../participation/options.js";
import { PartialCancelError, removeFromBooking } from "../participation/partialCancel.js";
import { AttendeeError, cleanAttendees, readAttendees, slotsForResolved, writeAttendees, type CleanAttendee } from "../participation/attendees.js";
import { QuestionError, activeQuestions, cleanAnswers, questionsVersion, readAnswersFor, toPublicQuestion, writeAnswers, type CleanAnswer } from "../participation/questions.js";
import { checkinsFor } from "../participation/checkin.js";
import { writeAudit } from "../audit.js";
import { capabilityForVendor } from "../capabilities.js";
import { LineError, assertOptionCapacity, legacySnapshot, linesSummary, optionsLeft, parseRequestedLines, readOrderLines, readOrderLinesFor, resolveLines, writeOrderLines, type ResolvedLines } from "../participation/lines.js";

// Adventures & Experiences — a standalone third listing type alongside
// centres/clubs (not nested under either), added post-IA-spec-audit. Same
// vendor_id/org ownership and approved-only public-read contract as
// centres/clubs (see db/index.ts's experiences/experience_sessions/
// experience_bookings comments), but booked per-session (a single
// departure), not per-listing the way a centre room booking is, and not a
// multi-session enrollment the way a Program is — see vendorExperiences.ts
// for the vendor-side CRUD half of this feature.

export interface ExperienceRow {
  id: string;
  vendor_id: string;
  kind: "adventure" | "experience" | "volunteer" | "event";
  title: string;
  area: string;
  county: string;
  lat: number | null;
  lng: number | null;
  location_source: string;
  meeting_point: string;
  blurb: string;
  description: string;
  difficulty: string;
  duration_minutes: number;
  fitness_requirements: string;
  itinerary: string;
  equipment_provided: string;
  equipment_required: string;
  transport_info: string;
  safety_info: string;
  accessibility_info: string | null;
  skills_required: string | null;
  cause: string;
  min_age: number | null;
  weather_policy: string;
  eligibility: string;
  cancellation_terms: string;
  price_cents: number;
  capacity: number;
  payment_method: string;
  image_url: string;
  status: string;
  views: number;
  featured: number;
  slug: string | null;
  created_at: string;
  distance_km: string | null;
  elevation_gain_m: number | null;
  terrain_type: string;
  vendor_business_name: string;
  vendor_name: string;
  vendor_business_checked: number | string;
}

async function toExperienceJson(row: ExperienceRow) {
  const images = (await db
    .prepare(`SELECT url FROM experience_images WHERE experience_id = ? ORDER BY sort_order`)
    .all(row.id)) as { url: string }[];
  const sessions = (await db
    .prepare(
      `SELECT id, date, time, capacity, status, sales_close_at as salesCloseAt, sales_close_at IS NOT NULL AND sales_close_at <= NOW() as salesClosed FROM experience_sessions
       WHERE experience_id = ? AND status = 'scheduled' AND date >= CURDATE() ORDER BY date, time`
    )
    .all(row.id)) as { id: string; date: string; time: string; capacity: number | null; status: string; salesCloseAt: string | null; salesClosed: number | boolean }[];
  const withAvailability = await Promise.all(
    sessions.map(async (s) => {
      const cap = s.capacity ?? row.capacity;
      const { n: booked } = (await db
        .prepare(
          `SELECT COALESCE(SUM(party_size), 0) as n FROM experience_bookings
           WHERE session_id = ? AND payment_status = 'paid' AND status != 'cancelled'`
        )
        .get(s.id)) as { n: number };
      return { id: s.id, date: s.date, time: s.time, capacity: cap, spotsLeft: Math.max(0, cap - Number(booked)), salesClosed: Number(s.salesClosed) === 1 };
    })
  );
  // Participation Phase 1 — registration options. A listing that sells through
  // options is bookable only while participation.options is on; otherwise its
  // booking box says registration is paused (never falls back to one price).
  const options = await activeOptions("experience", row.id);
  const registration =
    options.length === 0
      ? { mode: "single" as const, open: true, options: [] }
      : {
          mode: "options" as const,
          open: await participationOptionsOn(),
          options: options.map((o) => ({
            id: o.id,
            kind: o.kind,
            label: o.label,
            description: o.description,
            priceMinor: o.priceMinor,
            priceBasis: o.priceBasis,
            headsPerUnit: o.headsPerUnit,
            ageBand: o.ageBand,
            maxPerOrder: o.maxPerOrder,
            onSale: onSale(o),
            saleEndsAt: o.saleEndsAt,
          })),
        };
  // Participation Phase 2 — attendee details and registration questions (while the switch is on).
  const people = await attendeeConfig(row.vendor_id);
  const details = people.attendees
    ? { questions: people.questions ? (await activeQuestions("experience", row.id)).map(toPublicQuestion) : [], questionsVersion: await questionsVersion(row.id) }
    : null;
  const sessionsOut = registration.mode === "options" ? await Promise.all(withAvailability.map(async (s) => ({ ...s, optionsLeft: await optionsLeft(options, s.id) }))) : withAvailability;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    area: row.area,
    county: row.county,
    // DECIMAL(9,6) columns, same mysql2-returns-strings caveat as
    // distance_km below — every sibling listing type (queries.ts's centres/
    // clubs) already coerces these; this one was missed.
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
    locationSource: row.location_source || "unknown",
    meetingPoint: row.meeting_point,
    blurb: row.blurb,
    description: row.description,
    difficulty: row.difficulty,
    durationMinutes: row.duration_minutes,
    fitnessRequirements: row.fitness_requirements,
    itinerary: row.itinerary,
    equipmentProvided: row.equipment_provided,
    equipmentRequired: row.equipment_required,
    transportInfo: row.transport_info,
    safetyInfo: row.safety_info,
    accessibilityInfo: row.accessibility_info || null,
    newcomerWelcome: (row as { newcomer_welcome?: string | null }).newcomer_welcome ?? null,
    // Release 5 — volunteer listings only (empty/null otherwise).
    skillsRequired: row.skills_required || null,
    cause: row.cause || null,
    minAge: row.min_age ?? null,
    weatherPolicy: row.weather_policy,
    eligibility: row.eligibility,
    cancellationTerms: row.cancellation_terms,
    priceCents: row.price_cents,
    capacity: row.capacity,
    paymentMethod: row.payment_method,
    imageUrl: row.image_url,
    images: images.map((i) => i.url),
    sessions: sessionsOut,
    registration: { ...registration, attendeeDetails: details },
    featured: !!row.featured,
    slug: row.slug,
    createdAt: row.created_at,
    // DECIMAL columns come back from mysql2 as strings, not numbers, unless
    // decimalNumbers is set on the pool (it isn't) — coerce here, same
    // pattern vendor.ts's rating/totalViews coercion already uses.
    distanceKm: row.distance_km === null ? null : Number(row.distance_km),
    elevationGainM: row.elevation_gain_m,
    terrainType: row.terrain_type,
    // Vendor identity ("Hosted by") — the same businessName-or-name and
    // providerTier-derived verified flag providers.ts already returns for
    // a vendor's own public profile page; joined in here so the listing
    // itself can show/link to it without a second round trip.
    vendorId: row.vendor_id,
    vendorName: row.vendor_business_name || row.vendor_name,
    vendorVerified: !!Number(row.vendor_business_checked),
  };
}

export const experiencesRouter = Router();

// Both public reads join `users` for vendor identity ("Hosted by" —
// businessName-or-name + a verified flag off provider_tier, same derivation
// providers.ts uses for a vendor's own profile page). Conditions are
// qualified with `e.` throughout since `users` has its own `county` column
// (the vendor's own county, unrelated to the listing's) that would
// otherwise collide with the bare column name.
experiencesRouter.get("/", async (req, res) => {
  const { kind, county } = req.query as { kind?: string; county?: string };
  const conditions = [`e.status = 'approved'`, orgActiveSql("e.vendor_id")];
  const params: string[] = [];
  if (kind === "adventure" || kind === "experience" || kind === "volunteer" || kind === "event") {
    conditions.push(`e.kind = ?`);
    params.push(kind);
  }
  // Community events stay out of every public list until the switch is on
  // (a direct link to an approved event still opens it).
  if (!(await participationEventsOn())) conditions.push(`e.kind != 'event'`);
  if (county) {
    conditions.push(`e.county = ?`);
    params.push(county);
  }
  const tax = await taxonomyFilter("experience", "e.id", req.query as Record<string, unknown>);
  if (tax === "none") return res.json([]);
  if (tax) { conditions.push(tax.sql); params.push(...tax.params); }
  const rows = (await db
    .prepare(
      `SELECT e.*, u.business_name as vendor_business_name, u.name as vendor_name, ${businessCheckedSql("e.vendor_id")} as vendor_business_checked
       FROM experiences e JOIN users u ON u.id = e.vendor_id
       WHERE ${conditions.join(" AND ")} ORDER BY e.featured DESC, e.created_at DESC`
    )
    .all(...params)) as ExperienceRow[];
  res.json(await withCardLabels(await Promise.all(rows.map(toExperienceJson)), (e) => ({ type: "experience", id: e.id })));
});

// Same "approved only" contract as getApprovedCentre/getApprovedClub — a
// pending/rejected/deleted experience has no public detail page. Vendors see
// every status of their own via GET /vendor/experiences instead. Slug-or-id
// resolution (master-prompt punch list #1) — same convention as centres/
// clubs/circles.
experiencesRouter.get("/:id", async (req, res) => {
  const row = (await db
    .prepare(
      `SELECT e.*, u.business_name as vendor_business_name, u.name as vendor_name, ${businessCheckedSql("e.vendor_id")} as vendor_business_checked
       FROM experiences e JOIN users u ON u.id = e.vendor_id
       WHERE (e.slug = ? OR e.id = ?) AND e.status = 'approved' AND ${orgActiveSql("e.vendor_id")}`
    )
    .get(req.params.id, req.params.id)) as ExperienceRow | undefined;
  if (!row) {
    // D-01: a live listing of a suspended organisation shows an unavailable state.
    const unavailable = await unavailableListing("experience", req.params.id);
    if (unavailable) return res.json(unavailable);
    return res.status(404).json({ error: "Experience not found" });
  }
  await db.prepare(`UPDATE experiences SET views = views + 1 WHERE id = ?`).run(row.id);
  logView("activity_viewed", req, { kind: "experience", id: row.id });
  res.json({ ...(await toExperienceJson(row)), participationAttributes: await getListingAttributes("experience", row.id), ...(await officialCircleSummary("experiences", row.id)), ...(await taxonomyFields("experience", row.id)) });
});

/** Participation Phase 2 + configuration Phase B — whether a booking asks who
 * is coming and the organiser's questions: the platform switch AND the owning
 * organisation's capabilities. Reading what was already recorded never depends on it. */
async function attendeeConfig(vendorId: string): Promise<{ attendees: boolean; questions: boolean }> {
  if (!(await attendeesOn())) return { attendees: false, questions: false };
  const attendees = (await capabilityForVendor(vendorId, "attendees"))?.effective ?? false;
  const questions = attendees && ((await capabilityForVendor(vendorId, "registration_questions"))?.effective ?? false);
  return { attendees, questions };
}

interface BookBody {
  participantName: string;
  email: string;
  phone?: string;
  partySize?: number;
  couponCode?: string;
  /** Commerce Engine Phase 2 — the quote the customer was shown (optional:
   * without it checkout still prices server-side, it just can't detect that
   * the price moved since the form was rendered). */
  quoteId?: string;
  /** Stage 5b — apply the signed-in resident's HelloCircle credit (engine-priced only). */
  useCredits?: boolean;
  /** Booking UX Phase 4 — one name per seat (optional for older clients; if sent, one per person). */
  participants?: string[];
  /** B9 — required (true) when the experience sets a minimum age. */
  meetsMinAge?: boolean;
  /** B8 — recorded with the order: booking terms (version resolved server-side) and the listing's safety text. */
  acceptedTerms?: boolean;
  acceptedSafety?: boolean;
  /** Participation Phase 1 — [{ optionId, quantity }] for a listing with options. */
  lines?: unknown;
  /** Participation Phase 2 — [{ name, personType?, guardian? }] one per person, and answers. */
  attendees?: unknown;
  answers?: unknown;
  questionsVersion?: unknown;
}

// Books ONE session (a specific departure) — party_size spots on it, not a
// multi-session enrollment. Row-locks the session the same way bookings.ts
// row-locks a room, so two checkouts can't both take the same last spots.
/** HC-QA-042 — the one pricing calculation for an experience booking, shared
 * by the quote endpoint (what the booking form displays) and checkout (what
 * is stored/charged), so the two can never disagree. */
async function quoteExperience(experience: ExperienceRow, partySize: number, rawCoupon: string | undefined, lines: ResolvedLines | null = null) {
  // With options the list price is the server's sum of the lines.
  const subtotalCents = lines ? lines.listMinor : experience.price_cents * partySize;
  let discountCents = 0;
  let couponCode: string | null = null;
  if (rawCoupon) {
    const result = await evaluateCoupon(rawCoupon, subtotalCents, { listingType: "experience", listingId: experience.id });
    if (!result.valid) return { ok: false as const, error: result.error!, reason: result.reason ?? "invalid" };
    discountCents = result.discountCents!;
    couponCode = result.code!;
  }
  return { ok: true as const, pricing: computePricing(subtotalCents, 0, discountCents, couponCode), couponCode };
}

/** Commerce Engine Phase 2 — the same experience price, from the published
 * pricing rules instead of pricing.ts. Used only while the engine is switched
 * on for experiences; coupon evaluation is unchanged. */
async function engineQuoteExperience(experience: ExperienceRow, partySize: number, rawCoupon: string | undefined, availableCreditMinor = 0, lines: ResolvedLines | null = null) {
  const listMinor = lines ? lines.listMinor : experience.price_cents * partySize;
  let discountMinor = 0;
  let platformShareBps = 0;
  let couponCode: string | null = null;
  if (rawCoupon) {
    const result = await evaluateCoupon(rawCoupon, listMinor, { listingType: "experience", listingId: experience.id });
    if (!result.valid) return { ok: false as const, error: result.error!, reason: result.reason ?? "invalid" };
    discountMinor = Math.min(result.discountCents!, listMinor);
    platformShareBps = result.platformShareBps ?? 0;
    couponCode = result.code!;
  }
  // Phase 3 — the coupon's funding decides who absorbs the discount; the
  // split is exact (largest remainder), recorded in the order snapshot.
  const platformFundedDiscountMinor = discountMinor > 0 && platformShareBps > 0 ? allocate(discountMinor, [platformShareBps, 10_000 - platformShareBps])[0] : 0;
  // Stage 5b — customer credit is a HelloCircle-funded discount on what's left after the coupon.
  const creditMinor = Math.min(Math.max(0, availableCreditMinor), listMinor - discountMinor);
  const partner = await vendorPartner(experience.vendor_id);
  const price = await priceWithRules("experience", partner, {
    listMinor,
    discountMinor: discountMinor + creditMinor,
    depositMinor: 0,
    platformFundedDiscountMinor: platformFundedDiscountMinor + creditMinor,
  });
  return { ok: true as const, price, partner, couponCode, couponDiscountMinor: discountMinor, creditMinor };
}

/** Commerce Engine Phase 2 — prices with the published rules and stores a
 * single-use quote. Shared by this router's quote endpoint and the generic
 * POST /api/commerce/quotes (routes/commerce.ts). */
export async function storedExperienceQuote(experience: ExperienceRow, sessionId: string, partySize: number, rawCoupon: string | undefined, clientId: string | null, residentId: string | null, useCredits = false, lines: ResolvedLines | null = null) {
  const q = await engineQuoteExperience(experience, partySize, rawCoupon, await creditForCheckout(residentId, useCredits, Number.MAX_SAFE_INTEGER), lines);
  if (!q.ok) return { status: 400, body: { error: q.error, code: `coupon_${q.reason}` } };
  const stored = await createQuote({ sourceType: "experience", resourceId: experience.id, sessionId, quantity: partySize, couponCode: q.couponCode, clientId, residentId, linesKey: lines?.key ?? null }, q.price);
  const b = q.price.breakdown;
  return {
    status: 200,
    body: {
      partySize,
      ...(lines ? { lines: quoteLinesJson(lines) } : {}),
      subtotalCents: b.listMinor,
      discountCents: b.discountMinor,
      taxableCents: b.discountedMinor,
      vatCents: b.vatMinor,
      platformFeeCents: b.customerFeeMinor,
      totalCents: b.customerPaidMinor,
      couponCode: q.couponCode,
      creditCents: q.creditMinor,
      // R3A — the two parts of discountCents (coupon, then credit — the
      // engine's own order), and the credit balance left after this booking,
      // so the client shows them without subtracting anything itself.
      couponDiscountCents: q.couponDiscountMinor,
      creditBalanceAfterCents: residentId && q.creditMinor > 0 ? Math.max(0, (await creditBalance(residentId)) - q.creditMinor) : null,
      currency: "EUR",
      vatIncluded: q.price.values.vatMode === "included_in_price",
      quoteId: stored.id,
      quoteExpiresAt: stored.expiresAt,
    },
  };
}

/** Loads a bookable experience + session for quoting, or an HTTP error. */
export async function loadQuotableExperience(experienceId: string, sessionId: string) {
  const experience = (await db.prepare(`SELECT * FROM experiences WHERE id = ? AND status = 'approved' AND ${orgActiveSql("vendor_id")}`).get(experienceId)) as ExperienceRow | undefined;
  if (!experience) return { ok: false as const, status: 404, error: "Experience not found" };
  const session = await db.prepare(`SELECT id FROM experience_sessions WHERE id = ? AND experience_id = ?`).get(sessionId, experience.id);
  if (!session) return { ok: false as const, status: 404, error: "Session not found" };
  // A listing with registration options is quoted only by its own route
  // (POST /api/experiences/:id/sessions/:sessionId/quote with lines).
  if (await listingUsesOptions("experience", experience.id)) return { ok: false as const, status: 409, error: "Choose your options on the listing to see the price" };
  return { ok: true as const, experience };
}

/** The priced lines as the booking form shows them (server amounts only). */
function quoteLinesJson(lines: ResolvedLines) {
  return lines.lines.map((l) => ({ optionId: l.option.id, label: l.option.label, kind: l.option.kind, priceBasis: l.option.priceBasis, quantity: l.quantity, heads: l.heads, unitMinor: l.unitMinor, totalMinor: l.totalMinor }));
}

type LinesOutcome = { ok: true; lines: ResolvedLines | null } | { ok: false; status: number; error: string; code?: string };

/**
 * Participation Phase 1 — decides how an order is priced. A listing without
 * active options: no lines (today's path); sending `lines` anyway is refused.
 * A listing with options: `lines` are required and the options switch must
 * be on — otherwise registration is paused (409), never sold at one price.
 */
async function orderLinesFor(experience: ExperienceRow, rawLines: unknown, now: Date = new Date()): Promise<LinesOutcome> {
  const usesOptions = await listingUsesOptions("experience", experience.id);
  if (!usesOptions) {
    if (rawLines !== undefined && rawLines !== null) return { ok: false, status: 400, error: "This listing has one price — there are no options to choose", code: "no_options" };
    return { ok: true, lines: null };
  }
  if (!(await participationOptionsOn())) return { ok: false, status: 409, error: "Registration for this listing is paused for now", code: "registration_paused" };
  try {
    return { ok: true, lines: await resolveLines(experience.id, parseRequestedLines(rawLines), now) };
  } catch (e) {
    if (e instanceof LineError) return { ok: false, status: e.code === "sold_out" ? 409 : 400, error: e.message, code: `lines_${e.code}` };
    throw e;
  }
}

/** Authoritative price quote for the booking form (no reservation made). */
experiencesRouter.post("/:id/sessions/:sessionId/quote", commerceQuoteLimiter, async (req, res) => {
  const body = req.body as { partySize?: unknown; couponCode?: string; useCredits?: boolean; lines?: unknown };
  if (body.partySize !== undefined && !isPositiveInt(body.partySize)) return res.status(400).json({ error: "Party size must be a whole number of at least 1" });
  const experience = (await db.prepare(`SELECT * FROM experiences WHERE id = ? AND status = 'approved' AND ${orgActiveSql("vendor_id")}`).get(req.params.id)) as ExperienceRow | undefined;
  if (!experience) return res.status(404).json({ error: "Experience not found" });
  const session = await db.prepare(`SELECT id FROM experience_sessions WHERE id = ? AND experience_id = ?`).get(req.params.sessionId, experience.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const priced = await orderLinesFor(experience, body.lines);
  if (!priced.ok) return res.status(priced.status).json({ error: priced.error, code: priced.code });
  // With options the head count comes from the lines, never from partySize.
  const partySize = priced.lines ? priced.lines.heads : (body.partySize as number | undefined) ?? 1;
  if (await engineEnabledFor("experience")) {
    let clientId: string | null = null;
    try {
      clientId = clientIdFrom(req);
    } catch {
      clientId = null;
    }
    const r = await storedExperienceQuote(experience, req.params.sessionId, partySize, body.couponCode, clientId, req.resident?.id ?? null, body.useCredits === true, priced.lines);
    return res.status(r.status).json(r.body);
  }
  const quote = await quoteExperience(experience, partySize, body.couponCode, priced.lines);
  if (!quote.ok) return res.status(400).json({ error: quote.error, code: `coupon_${quote.reason}` });
  const { subtotalCents, discountCents, taxableCents, vatCents, platformFeeCents, totalCents } = quote.pricing;
  // Legacy pricing has no customer credit: the whole discount is the coupon.
  res.json({ partySize, ...(priced.lines ? { lines: quoteLinesJson(priced.lines) } : {}), subtotalCents, discountCents, taxableCents, vatCents, platformFeeCents, totalCents, couponCode: quote.couponCode, currency: "EUR", vatIncluded: false, couponDiscountCents: discountCents, creditCents: 0 });
});

experiencesRouter.post("/:id/sessions/:sessionId/checkout", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const body = req.body as BookBody;
  if (!body.participantName || !body.email) return res.status(400).json({ error: "Participant name and email are required" });
  if (!isValidEmail(body.email)) return res.status(400).json({ error: "That doesn't look like a valid email address" });
  // HC-QA-039 — party size is an authoritative whole number (it drives both
  // price and seats); omitted means 1, anything else invalid is rejected.
  if (body.partySize !== undefined && !isPositiveInt(body.partySize)) return res.status(400).json({ error: "Party size must be a whole number of at least 1" });
  let partySize = body.partySize ?? 1;

  const experience = (await db.prepare(`SELECT * FROM experiences WHERE id = ?`).get(req.params.id)) as ExperienceRow | undefined;
  if (!experience) return res.status(404).json({ error: "Experience not found" });
  if (experience.status !== "approved") return res.status(409).json({ error: "This listing is no longer open for booking" });
  if (!(await offeringSellable(experience.vendor_id))) return res.status(409).json({ error: VENDOR_SUSPENDED_ERROR });

  const session = (await db
    .prepare(`SELECT id, capacity, status, date, time, sales_close_at as salesCloseAt FROM experience_sessions WHERE id = ? AND experience_id = ?`)
    .get(req.params.sessionId, experience.id)) as { id: string; capacity: number | null; status: string; date: string; time: string; salesCloseAt: string | Date | null } | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.status !== "scheduled") return res.status(409).json({ error: "This session is no longer open for booking" });
  // Participation Phase 1 — options decide the price and the head count.
  const priced = await orderLinesFor(experience, body.lines);
  if (!priced.ok) return res.status(priced.status).json({ error: priced.error, code: priced.code });
  const lines = priced.lines;
  if (lines) partySize = lines.heads;
  // Booking UX Phase 4 — minimum age (a declaration) and named seats.
  const ageError = minAgeError(experience.min_age, body.meetsMinAge);
  if (ageError) return res.status(400).json({ error: ageError, minAge: experience.min_age });
  let seatNames = cleanParticipantNames(body.participants, partySize);
  if (seatNames && "error" in seatNames) return res.status(400).json({ error: seatNames.error });
  // Participation Phase 2 — who is coming and the organiser's questions. Only
  // while participation.attendees is on; an older client that sends no
  // attendees still books (its people are read from the seat names), but
  // required questions must be answered by everyone.
  let people: CleanAttendee[] | null = null;
  let answers: CleanAnswer[] = [];
  let answeredVersion = 0;
  const peopleConfig = await attendeeConfig(experience.vendor_id);
  if (peopleConfig.attendees) {
    const questions = peopleConfig.questions ? await activeQuestions("experience", experience.id) : [];
    answeredVersion = await questionsVersion(experience.id);
    try {
      if (body.attendees !== undefined) {
        people = cleanAttendees(body.attendees, slotsForResolved(lines, partySize));
        seatNames = people.map((p) => p.name);
      }
      if (questions.length) {
        // Phase M — no form sent at all (an older app, or a page from before the form was published).
        if (body.questionsVersion === undefined || body.questionsVersion === null) return res.status(409).json({ error: FORM_REQUIRED, code: "form_required" });
        if (body.questionsVersion !== answeredVersion) return res.status(409).json({ error: "The organiser changed the registration questions — please check your answers", code: "questions_changed" });
        const who = people ?? (seatNames ?? Array.from({ length: partySize }, (_, i) => (i === 0 ? body.participantName : `Person ${i + 1}`))).map((name, i) => ({ attendeeNo: i + 1, personType: "adult" as const, name }));
        answers = cleanAnswers(questions, body.answers, who);
      }
    } catch (e) {
      if (e instanceof AttendeeError) return res.status(400).json({ error: e.message, code: "attendees_invalid" });
      if (e instanceof QuestionError) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }
  }
  // HC-QA-045 — a session that has already started can't take new bookings.
  if (!startIsInFuture(session.date, session.time)) return res.status(409).json({ error: "This session has already started" });
  // OG-19 — the partner can close bookings for a departure ahead of its start.
  if (session.salesCloseAt && new Date(session.salesCloseAt).getTime() <= Date.now()) return res.status(409).json({ error: "Booking has closed for this date" });

  const isCash = experience.payment_method === "cash";
  // Commerce Engine Phase 2 — with the engine on, the published rules price
  // this booking and a commerce order + immutable snapshot is written in the
  // same transaction; with it off, legacy pricing plus an optional shadow
  // comparison. Either way `pricing` keeps the legacy shape the rest of this
  // handler (and the stored columns) already use.
  const useEngine = await engineEnabledFor("experience");
  let pricing: { taxableCents: number; discountCents: number; vatCents: number; platformFeeCents: number; totalCents: number; couponCode: string | null };
  let couponCode: string | null;
  let engine: (Awaited<ReturnType<typeof engineQuoteExperience>> & { ok: true }) | null = null;
  let legacyPricing: ReturnType<typeof computePricing> | null = null;
  if (useEngine) {
    const q = await engineQuoteExperience(experience, partySize, body.couponCode, await creditForCheckout(req.resident?.id, body.useCredits === true, Number.MAX_SAFE_INTEGER), lines);
    if (!q.ok) return res.status(400).json({ error: q.error });
    engine = q;
    couponCode = q.couponCode;
    const cols = legacyColumns(q.price.breakdown);
    pricing = { taxableCents: cols.subtotalCents, discountCents: cols.discountCents, vatCents: cols.vatCents, platformFeeCents: cols.platformFeeCents, totalCents: cols.totalCents, couponCode };
  } else {
    const quote = await quoteExperience(experience, partySize, body.couponCode, lines);
    if (!quote.ok) return res.status(400).json({ error: quote.error });
    pricing = legacyPricing = quote.pricing;
    couponCode = quote.couponCode;
  }
  const ref = generateRef("EX");
  if (legacyPricing) {
    const shadowed = legacyPricing;
    void vendorPartner(experience.vendor_id).then((partner) => shadowPrice("experience", ref, partner, shadowed));
  }
  const quoteInput = { sourceType: "experience" as const, resourceId: experience.id, sessionId: req.params.sessionId, quantity: partySize, couponCode, clientId, residentId: req.resident?.id ?? null, linesKey: lines?.key ?? null };
  // Release 5 — a free booking (always true for a volunteer listing, whose
  // price is forced to 0) confirms immediately like cash; it previously
  // fell through to a €0 Stripe checkout.
  const confirmsNow = isCash || pricing.totalCents === 0;

  try {
    await db.transaction(async (tx) => {
      await tx.prepare(`SELECT id FROM experience_sessions WHERE id = ? FOR UPDATE`).get(session.id);
      // D-01: re-check the member and organisation under a shared lock on the organisation row.
      await assertSellable(tx, experience.vendor_id);
      const cap = session.capacity ?? experience.capacity;
      // HC-QA-041 — live pending checkouts hold their seats; status re-read under the lock.
      const locked = (await tx.prepare(`SELECT status FROM experience_sessions WHERE id = ?`).get(session.id)) as { status: string };
      if (locked.status !== "scheduled") throw new ConflictError("This session is no longer open for booking");
      const { n: booked } = (await tx
        .prepare(`SELECT COALESCE(SUM(party_size), 0) as n FROM experience_bookings WHERE session_id = ? AND ${occupiesCapacitySql()}`)
        .get(session.id)) as { n: number };
      if (Number(booked) + partySize > cap) throw new ConflictError("Not enough spots left on this session");
      // Participation Phase 1 — each option's own limit (lock order: session, then options by id).
      if (lines) await assertOptionCapacity(tx, session.id, lines);
      // HC-QA-037/050 — the coupon use is reserved with the order (confirmed or pending).
      if (couponCode) {
        try {
          await consumeCoupon(tx, couponCode, { sourceType: "experience", ref, customerKey: customerKeyOf(req.resident?.id, clientId), discountMinor: engine ? engine.couponDiscountMinor : pricing.discountCents, confirmed: confirmsNow });
        } catch (e) {
          throw new BadRequestError(e instanceof Error ? e.message : "That code has been fully redeemed");
        }
      }

      // Stage 5b — reserve the credit with the order (confirmed now if nothing is left to pay).
      if (engine && engine.creditMinor > 0 && req.resident?.id) {
        try {
          await reserveCredit(tx, { residentId: req.resident.id, sourceType: "experience", ref, amountMinor: engine.creditMinor, confirmed: confirmsNow });
        } catch (e) {
          throw new ConflictError(e instanceof Error ? e.message : "Your credit balance changed");
        }
      }

      await tx
        .prepare(
          `INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, phone, party_size,
            subtotal_cents, discount_cents, vat_cents, platform_fee_cents, coupon_code, total_cents, payment_status, pricing_mode)
           VALUES (@ref, @experienceId, @sessionId, @clientId, @residentId, @participantName, @email, @phone, @partySize,
            @subtotalCents, @discountCents, @vatCents, @platformFeeCents, @couponCode, @totalCents, @status, @pricingMode)`
        )
        .run({
          ref,
          experienceId: experience.id,
          sessionId: session.id,
          clientId,
          residentId: req.resident?.id ?? null,
          participantName: body.participantName,
          email: body.email,
          phone: body.phone ?? "",
          partySize,
          subtotalCents: pricing.taxableCents,
          discountCents: pricing.discountCents,
          vatCents: pricing.vatCents,
          platformFeeCents: pricing.platformFeeCents,
          couponCode: pricing.couponCode,
          totalCents: pricing.totalCents,
          status: confirmsNow ? "paid" : "pending",
          pricingMode: lines ? "lines" : "single",
        });

      await recordOrderAcknowledgements(tx, {
        sourceType: "experience",
        ref,
        clientId,
        residentId: req.resident?.id ?? null,
        terms: body.acceptedTerms === true,
        safetyText: body.acceptedSafety === true ? experience.safety_info : null,
      });
      await recordParticipantNames(tx, ref, seatNames ?? []);
      if (people) await writeAttendees(tx, "experience", ref, people);
      if (answers.length) await writeAnswers(tx, "experience", ref, answeredVersion, answers, "booker", true);
      // Frozen at purchase: label, basis, unit price and the tax/fee rule in force.
      if (lines) {
        await writeOrderLines(tx, "experience", ref, lines, engine
          ? { vatBps: engine.price.values.vatBps, vatMode: engine.price.values.vatMode, feeBps: engine.price.values.customerFeeBps, source: `engine:${engine.price.resolved.hash}` }
          : legacySnapshot());
      }

      if (engine) {
        if (body.quoteId) await consumeQuote(tx, body.quoteId, quoteInput, engine.price);
        await createOrder(tx, {
          sourceType: "experience",
          sourceRef: ref,
          partner: engine.partner ?? { kind: "vendor", id: experience.vendor_id, vendorUserId: experience.vendor_id, hostResidentId: null, orgId: null },
          customerClientId: clientId,
          customerResidentId: req.resident?.id ?? null,
          quoteId: body.quoteId ?? null,
          couponCode,
          paymentStatus: confirmsNow ? "paid" : "pending",
          line: { itemType: "experience_session", itemId: session.id, quantity: partySize, unitMinor: experience.price_cents },
          lines: lines?.lines.map((l) => ({ itemType: "experience_option", itemId: l.option.id, quantity: l.quantity, unitMinor: l.unitMinor })),
          price: engine.price,
        });
      }
    });
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message });
    if (e instanceof QuoteError) return res.status(409).json({ error: e.message, code: e.code });
    if (e instanceof LineError) return res.status(409).json({ error: e.message, code: `lines_${e.code}` });
    throw e;
  }

  const chosen = lines ? linesSummary(lines.lines.map((l) => ({ label: l.option.label, quantity: l.quantity }))) : null;
  const detailsText =
    experience.kind === "volunteer"
      ? `${body.participantName} · ${partySize} volunteer${partySize === 1 ? "" : "s"}`
      : `${body.participantName} · ${chosen ? `${chosen} · ` : ""}party of ${partySize} · €${(pricing.totalCents / 100).toFixed(2)}${isCash ? " due in cash on arrival" : pricing.totalCents === 0 ? " (free)" : " total"}`;

  if (confirmsNow) {
    notifyNewBookingOrRegistration({
      kind: "booking",
      listingType: "experience",
      listingId: experience.id,
      listingName: experience.title,
      vendorId: experience.vendor_id,
      guestName: body.participantName,
      guestEmail: body.email,
      ref,
      detailsText,
      residentId: req.resident?.id ?? null,
    }).catch((e) => console.error("[notifications] experience booking notify failed:", e));
    if (req.resident?.id) await upgradeFavouriteStatus(req.resident.id, "experience", experience.id);
    void logEvent("booking_completed", { residentId: req.resident?.id ?? null, clientId, metadata: { type: "experience", ref, via: "immediate" } });
    return res.status(201).json({ ref, totalEuro: pricing.totalCents / 100 });
  }

  const result = await createCheckoutSession({
    ref,
    type: "experience",
    customerEmail: body.email,
    residentId: req.resident?.id ?? null,
    lineItems: engine
      ? engineLineItems(engine.price.breakdown, engine.price.values, {
          name: experience.title,
          description: `${body.participantName} · ${chosen ? `${chosen} · ` : ""}party of ${partySize}${couponCode ? ` (coupon ${couponCode} applied)` : ""}`,
        })
      : pricingLineItems(pricing, {
          name: experience.title,
          description: `${body.participantName} · ${chosen ? `${chosen} · ` : ""}party of ${partySize}${couponCode ? ` (coupon ${couponCode} applied)` : ""}`,
        }),
  });
  if (!result.ok) {
    await endPendingHold("experience_bookings", ref, "delete");
    await syncOrderFromSource("experience", ref);
    if (engine && body.quoteId) await releaseQuote(body.quoteId);
    return res.status(result.status).json({ error: result.error });
  }

  await db.prepare(`UPDATE experience_bookings SET stripe_session_id = ? WHERE ref = ?`).run(result.session.id, ref);
  await syncOrderFromSource("experience", ref);
  res.status(201).json({ ref, url: result.session.url, totalEuro: pricing.totalCents / 100 });
});

// Every experience booking under this device's client_id or (if signed in)
// this resident's email — same OR-matched ownership pattern as
// GET /enrollments/mine on programs.ts.
experiencesRouter.get("/bookings/mine", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const rows = (await db
    .prepare(
      `SELECT eb.ref, eb.experience_id as experienceId, eb.participant_name as participantName, eb.party_size as partySize,
              eb.total_cents as totalCents, eb.status, eb.payment_status as paymentStatus, eb.created_at as createdAt,
              eb.stripe_session_id IS NOT NULL as paidOnline,
              e.title, e.image_url as imageUrl, e.kind, e.vendor_id as vendorId, es.date, es.time,
              (SELECT a.status FROM attendance a WHERE a.kind = 'experience' AND a.ref = eb.ref) as attendance
       FROM experience_bookings eb
       JOIN experiences e ON e.id = eb.experience_id
       JOIN experience_sessions es ON es.id = eb.session_id
       WHERE (eb.client_id = ? OR (eb.resident_id IS NOT NULL AND eb.resident_id = ?)) AND eb.payment_status IN ('paid', 'refunded')
       ORDER BY eb.created_at DESC`
    )
    .all(clientId, req.resident?.id ?? "")) as (Record<string, unknown> & { status: string; paymentStatus: string; totalCents: number; paidOnline: number; vendorId: string; date: string; time: string })[];
  // Phase 11B — canCancel/refundState come from the same rules the cancel
  // route enforces (selfCancel.ts), so the UI never offers what the server refuses.
  const hoursByVendor = new Map<string, number>();
  // Participation Phase 1 — purchased lines (never switch-gated).
  const linesByRef = await readOrderLinesFor("experience", rows.map((r) => String(r.ref)));
  const out = [];
  for (const { paidOnline, ...r } of rows) {
    if (!hoursByVendor.has(r.vendorId)) hoursByVendor.set(r.vendorId, (await orgPoliciesForVendor(r.vendorId)).cancellationHours);
    const lines = linesByRef.get(String(r.ref)) ?? [];
    out.push({ ...r, paidOnline: !!paidOnline, canCancel: experienceCancelBlock(r, hoursByVendor.get(r.vendorId)!) === null, refundState: refundStateOf({ ...r, paidOnline }), lines, linesSummary: lines.length ? linesSummary(lines) : null });
  }
  res.json(out);
});

/** Resident/guest self-cancel — Phase 0 protect. Experience bookings
 * previously had no cancel route at all, even though experience_bookings.
 * status already supports 'cancelled' (only ever unused). Same
 * client_id-or-resident-id ownership convention as GET /bookings/mine
 * above. Unlike Programs (which have no single dated occurrence), an
 * Experience booking is tied to one specific session, so this applies the
 * same org cancellationHours cutoff check bookings.ts uses. No refund here
 * (off-platform convention) — see vendorExperiences.ts for the vendor-
 * issued Stripe refund. No waitlist/capacity restoration call — Experiences
 * have no waitlist concept. */
// Participation Phase 1 — remove people from a booking bought with options
// (partial cancellation, participation/partialCancel.ts). The switch is locked
// off until the owner approves; while off this route doesn't exist (404).
// Same ownership and cancellation cut-off as the full cancel below.
experiencesRouter.post("/bookings/:ref/remove", async (req, res) => {
  if (!(await partialCancelOn())) return res.status(404).json({ error: "This isn't available yet" });
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const { lineNo, quantity, expectedRefunded } = (req.body ?? {}) as { lineNo?: unknown; quantity?: unknown; expectedRefunded?: unknown };
  if (!isPositiveInt(lineNo) || !isPositiveInt(quantity) || typeof expectedRefunded !== "number" || !Number.isInteger(expectedRefunded) || expectedRefunded < 0) {
    return res.status(400).json({ error: "Say which part of the booking and how many to remove" });
  }
  const row = (await db
    .prepare(
      `SELECT eb.ref, eb.status, eb.payment_status as paymentStatus, eb.total_cents as totalCents, eb.stripe_session_id IS NOT NULL as paidOnline, es.date, es.time, e.vendor_id as vendorId
       FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id
       WHERE eb.ref = ? AND (eb.client_id = ? OR (eb.resident_id IS NOT NULL AND eb.resident_id = ?))`
    )
    .get(req.params.ref, clientId, req.resident?.id ?? "")) as
    | { ref: string; status: string; paymentStatus: string; totalCents: number; paidOnline: number; date: string; time: string; vendorId: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  const { cancellationHours } = await orgPoliciesForVendor(row.vendorId);
  const block = experienceCancelBlock(row, cancellationHours);
  if (block) return res.status(block.status).json({ error: block.error });
  try {
    const r = await removeFromBooking({ ref: row.ref, lineNo: lineNo as number, quantity: quantity as number, expectedRefunded, actor: req.resident ? { kind: "resident", id: req.resident.id } : { kind: "client", id: clientId } });
    void sweepSpotAlerts(undefined).catch(() => undefined);
    res.json({ ok: true, ...r, lines: await readOrderLines("experience", row.ref) });
  } catch (e) {
    if (e instanceof PartialCancelError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

experiencesRouter.post("/bookings/:ref/cancel", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const row = (await db
    .prepare(
      `SELECT eb.ref, eb.status, eb.payment_status as paymentStatus, eb.participant_name as participantName, eb.email, eb.resident_id as residentId,
              eb.total_cents as totalCents, eb.stripe_session_id IS NOT NULL as paidOnline,
              es.date, es.time, es.id as sessionId,
              e.id as experienceId, e.title, e.vendor_id as vendorId
       FROM experience_bookings eb
       JOIN experience_sessions es ON es.id = eb.session_id
       JOIN experiences e ON e.id = eb.experience_id
       WHERE eb.ref = ? AND (eb.client_id = ? OR (eb.resident_id IS NOT NULL AND eb.resident_id = ?))`
    )
    .get(req.params.ref, clientId, req.resident?.id ?? "")) as
    | { ref: string; status: string; paymentStatus: string; participantName: string; email: string; residentId: string | null; totalCents: number; paidOnline: number; date: string; time: string; sessionId: string; experienceId: string; title: string; vendorId: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  const { cancellationHours } = await orgPoliciesForVendor(row.vendorId);
  const block = experienceCancelBlock(row, cancellationHours);
  if (block) return res.status(block.status).json({ error: block.error });

  // HC-QA-046 — atomic transition: only the request that actually flips the row
  // runs the side effects (capacity release, audit, notifications, promotion).
  const flipped = await db.prepare(`UPDATE experience_bookings SET status = 'cancelled' WHERE ref = ? AND status != 'cancelled'`).run(row.ref);
  if (flipped.changes !== 1) return res.status(409).json({ error: "This booking is already cancelled" });
  await syncOrderFromSource("experience", row.ref);

  notifyCancellation({
    kind: "experience",
    listingType: "experience",
    listingId: row.experienceId,
    listingName: row.title,
    vendorId: row.vendorId,
    guestName: row.participantName,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.date} at ${row.time} · ${row.title}`,
    residentId: row.residentId,
  }).catch((e) => console.error("[notifications] experience booking cancellation notify failed:", e));

  // Experience 3.0 — a freed place may be someone's spot alert (no-op while off).
  void sweepSpotAlerts(row.sessionId).catch((e) => console.error("[spot-alerts] sweep failed:", e));
  res.json({ ok: true, status: "cancelled", refundState: refundStateOf({ ...row, status: "cancelled" }) });
});

// Participation Phase 2 — who is coming, their answers and check-in, for the
// person who made the booking (same client_id-or-resident ownership as
// /bookings/mine). Never switch-gated for reading. No amounts here; the
// status route and receipts carry those.
async function ownedBookingForDetails(req: import("express").Request, res: import("express").Response) {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) {
      res.status(400).json({ error: e.message });
      return null;
    }
    throw e;
  }
  const row = (await db
    .prepare(
      `SELECT eb.ref, eb.experience_id AS experienceId, eb.participant_name AS participantName, eb.party_size AS partySize, eb.status,
              eb.payment_status AS paymentStatus, es.date, es.time, e.title, e.kind, e.vendor_id AS vendorId
       FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id
       WHERE eb.ref = ? AND (eb.client_id = ? OR (eb.resident_id IS NOT NULL AND eb.resident_id = ?))`
    )
    .get(req.params.ref, clientId, req.resident?.id ?? "")) as
    | { ref: string; experienceId: string; participantName: string; partySize: number; status: string; paymentStatus: string; date: string; time: string; title: string; kind: string; vendorId: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: "Booking not found" });
    return null;
  }
  return { ...row, partySize: Number(row.partySize) };
}

async function bookingDetailsJson(row: NonNullable<Awaited<ReturnType<typeof ownedBookingForDetails>>>) {
  const people = await readAttendees("experience", { ref: row.ref, partySize: row.partySize, participantName: row.participantName });
  const checks = (await checkinsFor([row.ref])).get(row.ref) ?? [];
  const answers = (await readAnswersFor("experience", [row.ref])).get(row.ref) ?? [];
  const on = (await attendeeConfig(row.vendorId)).questions;
  const questions = on ? await activeQuestions("experience", row.experienceId) : [];
  const editable = on && questions.length > 0 && row.paymentStatus === "paid" && row.status !== "cancelled" && startIsInFuture(row.date, row.time);
  const active = people.filter((p) => p.status === "active");
  const missing = questions
    .filter((q) => q.required)
    .flatMap((q) =>
      q.scope === "booking"
        ? answers.some((a) => a.attendeeNo === 0 && a.key === q.key) ? [] : [q.label]
        : active.filter((p) => (q.appliesTo === "all" || q.appliesTo === p.personType) && !answers.some((a) => a.attendeeNo === p.attendeeNo && a.key === q.key)).map((p) => `${p.name}: ${q.label}`)
    );
  return {
    ref: row.ref,
    title: row.title,
    kind: row.kind,
    date: row.date,
    time: row.time,
    status: row.status,
    paymentStatus: row.paymentStatus,
    contactName: row.participantName,
    partySize: row.partySize,
    attendees: people.map((p) => {
      const hit = checks.find((c) => Number(c.attendee_no) === p.attendeeNo);
      return { ...p, checkedInAt: hit ? new Date(hit.checked_in_at).toISOString() : null };
    }),
    answers,
    questions: questions.map(toPublicQuestion),
    questionsVersion: on ? await questionsVersion(row.experienceId) : 0,
    canEditAnswers: editable,
    missingAnswers: editable ? missing : [],
  };
}

experiencesRouter.get("/bookings/:ref/details", async (req, res) => {
  const row = await ownedBookingForDetails(req, res);
  if (!row) return;
  res.json(await bookingDetailsJson(row));
});

/** Edit answers before the start. Answers to questions the organiser has
 * since removed are kept as they were (with their own snapshot). */
experiencesRouter.put("/bookings/:ref/answers", async (req, res) => {
  const row = await ownedBookingForDetails(req, res);
  if (!row) return;
  if (!(await attendeeConfig(row.vendorId)).questions) return res.status(404).json({ error: "This isn't available yet" });
  if (row.status === "cancelled" || row.paymentStatus !== "paid") return res.status(409).json({ error: "Only a confirmed booking can be changed" });
  if (!startIsInFuture(row.date, row.time)) return res.status(409).json({ error: "Answers can't be changed once it has started" });
  const questions = await activeQuestions("experience", row.experienceId);
  const version = await questionsVersion(row.experienceId);
  if ((req.body ?? {}).questionsVersion !== version) return res.status(409).json({ error: "The organiser changed the questions — reload to see them", code: "questions_changed" });
  const people = (await readAttendees("experience", { ref: row.ref, partySize: row.partySize, participantName: row.participantName })).filter((p) => p.status === "active");
  let cleaned: CleanAnswer[];
  try {
    cleaned = cleanAnswers(questions, req.body?.answers, people);
  } catch (e) {
    if (e instanceof QuestionError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
  // Phase F — a question marked "can't be changed after booking" keeps the
  // answer already given, whatever is sent; it can only be answered if it wasn't.
  const existing = (await readAnswersFor("experience", [row.ref])).get(row.ref) ?? [];
  const lockedGiven = (key: string, attendeeNo: number) => existing.some((a) => a.key === key && a.attendeeNo === attendeeNo);
  const lockedKeys = new Set(questions.filter((q) => q.editability === "locked").map((q) => q.key));
  const toWrite = cleaned.filter((a) => !(lockedKeys.has(a.question.key) && lockedGiven(a.question.key, a.attendeeNo)));
  const editableKeys = questions.filter((q) => !lockedKeys.has(q.key)).map((q) => q.key);
  await db.transaction(async (tx) => {
    if (editableKeys.length) {
      await tx
        .prepare(`DELETE FROM registration_answers WHERE source_type = 'experience' AND source_ref = ? AND qkey IN (${editableKeys.map(() => "?").join(", ")})`)
        .run(row.ref, ...editableKeys);
    }
    await writeAnswers(tx, "experience", row.ref, version, toWrite, req.resident ? "resident" : "booker", false);
  });
  await writeAudit({
    actorUserId: null,
    actorKind: req.resident ? "resident" : "system",
    action: "experience_booking.answers_edited",
    objectType: "experience_booking",
    objectId: row.ref,
    newValue: { questionsVersion: version, keys: [...new Set(cleaned.map((a) => a.question.key))] },
  });
  // Phase K — the partner hears that answers changed (never the answers).
  void notifyAnswersChanged({ kind: "experience", listingType: "experience", listingId: row.experienceId, listingName: row.title, vendorId: row.vendorId, ref: row.ref, changed: new Set(toWrite.map((a) => a.question.key)).size });
  res.json(await bookingDetailsJson(row));
});

experiencesRouter.get("/bookings/status/:ref", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  // Resident Experience Polish — Changeset 5, same reasoning as
  // bookings.ts's GET /status/:ref.
  const row = (await db
    .prepare(
      `SELECT eb.ref, eb.payment_status as paymentStatus, eb.total_cents as totalCents,
              e.id as experienceId, e.kind, e.title, e.meeting_point as meetingPoint, es.date, es.time, eb.party_size as partySize, e.vendor_id as vendorId
       FROM experience_bookings eb JOIN experiences e ON e.id = eb.experience_id JOIN experience_sessions es ON es.id = eb.session_id
       WHERE eb.ref = ? AND eb.client_id = ?`
    )
    .get(req.params.ref, clientId)) as ({ vendorId: string; date: string; time: string } & Record<string, unknown>) | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  // Booking UX Phase 3 — the confirmation page states the deadline (same rule as self-cancel).
  const { vendorId, ...rest } = row;
  const { cancellationHours } = await orgPoliciesForVendor(vendorId);
  const paymentReview = row.paymentStatus === "pending" && (await paymentUnderReview("experience", req.params.ref));
  res.json({ ...rest, lines: await readOrderLines("experience", req.params.ref), cancelDeadline: cancelDeadlineIso(row.date, row.time, cancellationHours), paymentReview, paymentCase: await customerPaymentCase("experience", req.params.ref) });
});

// "Add to calendar" — same client_id ownership gate + server-generated .ics
// as bookings.ts's own GET /:ref/ics, adapted to a session's date/time
// (Ireland wall-clock, DST-aware) and the listing's duration_minutes for
// the event length instead of a fixed booking duration column.
experiencesRouter.get("/bookings/:ref/ics", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const row = (await db
    .prepare(
      `SELECT eb.ref, es.date, es.time, e.title, e.duration_minutes as durationMinutes, e.area, e.county, e.meeting_point as meetingPoint
       FROM experience_bookings eb
       JOIN experience_sessions es ON es.id = eb.session_id
       JOIN experiences e ON e.id = eb.experience_id
       WHERE eb.ref = ? AND eb.client_id = ? AND eb.payment_status = 'paid'`
    )
    .get(req.params.ref, clientId)) as
    | { ref: string; date: string; time: string; title: string; durationMinutes: number; area: string; county: string; meetingPoint: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });

  const [h, m] = row.time.split(":").map(Number);
  const start = irelandWallTimeToUtc(row.date, h, m);
  const end = new Date(start.getTime() + Math.max(30, row.durationMinutes) * 60 * 1000);
  const ics = buildIcsEvent({
    uid: `experience-booking-${row.ref}`,
    title: row.title,
    description: row.meetingPoint || undefined,
    location: `${row.area}, ${row.county}`,
    start,
    end,
  });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="experience-booking-${row.ref}.ics"`);
  res.send(ics);
});
