import { Euro } from "lucide-react";
import { WhatToExpect, experienceExpectFacts } from "../components/trust/WhatToExpect";
import { SpotAlertButton } from "../components/experience/SpotAlertButton";
import { OptionPicker, headsOf, selectedLines, type OptionQuantities } from "../components/experience/OptionPicker";
import { BookingActions, BookingFacts, BookingGlance, BookingPrice, directionsHref, IconAction, QuietAction, startsIn, type GlanceItem } from "../components/BookingFacts";
import { formatDuration } from "../formatters";
import { Pass, passDate, passTime } from "../components/pass/Pass";
import { PlanWithCircle } from "../components/circle/PlanWithCircle";
import { ExploreWithOthers } from "../components/circle/ExploreWithOthers";
import { UsersRound } from "lucide-react";
import { CategoryBreadcrumb } from "../components/categories/CategoryChips";
import { UnavailableListing, isUnavailable, type Unavailable } from "../components/UnavailableListing";
import { usePageTitle } from "../pageTitle";
import { PAID_CLOSED_MESSAGE, usePaidCheckoutOpen } from "../paidCheckout";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { TraderInfo } from "../components/TraderInfo";
import { OfficialCircleLink } from "../components/OfficialCircleLink";
import { ParticipationBlock } from "../components/ParticipationBlock";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { CheckoutBreakdown } from "../components/CheckoutBreakdown";
import { AnalyticsEvent, trackTypedEvent } from "../analyticsEvents";
import { AttendeeFields, type AnswersDraft } from "../components/experience/AttendeeFields";
import { fitPeople, missingAnswers, personSlots, toAttendeeInput, withDefaults, type PersonDraft } from "../components/experience/attendeeSlots";
import { ApiError, isNotFound, bookExperienceSession, fetchMyCredits, downloadExperienceBookingIcs, fetchExperience, fetchExperiences, quoteExperienceSession, type BookingQuote } from "../api";
import { openCheckout } from "../native";
import { ListingChatButton } from "../components/ListingChats";
import { ExperienceCard } from "../components/ExperienceCard";
import { FieldError, FormErrorSummary, NumberStepper, useFormErrors, type FormError } from "../components/form";
import { CalendarIcon, CheckIcon, ClockIcon, PinIcon, ShareIcon, ShieldIcon, TreeIconSmall, TrendUpIcon, UsersIcon, PersonIcon, HeartIcon } from "../components/icons";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { InviteSheetButton } from "../components/InviteSheetButton";
import { ShareButton } from "../components/ShareButton";
import { Photo } from "../components/Photo";
import { PhotoGallery } from "../components/PhotoGallery";
import { Reviews } from "../components/Reviews";
import { Button, Card, Modal, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
import { dateLabel } from "../euro";
import { cardImageRatio, colors, fonts, maxWidth, photoOverlay, radius } from "../theme";
import { isValidEmail } from "../validate";
import type { Experience, ExperienceSessionSlot } from "../types";
import { formatPrice } from "../formatters";
import { CtaBand } from "../components/CtaBand";
import { DetailSection, HostRow, LocationBlock } from "../components/detail/DetailSections";
import { KeyFacts, PAID_PRICE_NOTE } from "../components/detail/KeyFacts";
import { DetailTopBar, detailActionStyle } from "../components/detail/DetailTopBar";
import { DetailUnavailable } from "../components/detail/DetailUnavailable";
import { scrollToInterest } from "../components/detail/scrollToInterest";

// Adventures & Experiences detail page — this pass rebuilds it to use
// GameDetail.tsx as the literal visual/layout source of truth (badge-
// overlaid hero, title below the image, sticky right-rail Join card with a
// headline + divider + info rows, the same GoodToKnow/CancellationCard
// shapes, the same mint closing band, the same mobile sticky bar pattern —
// see GameJoinCard.tsx's MobileJoinBar), rather than the cinematic-overlay
// treatment an earlier pass tried. Layered on top: Adventure/Experience-
// specific real fields (difficulty, duration, equipment, safety text,
// meeting point) that Games don't carry. Deliberately still not fabricating
// what doesn't exist in this product: no host avatar/messaging, no Circle
// affiliation, no participant avatars/reviews — see this file's git history
// for the fuller audit. The one adaptation booking itself can't avoid: a
// Game is a single tap ("I'm in"); an Experience/Adventure books ONE of
// several real sessions via a short form, so the right-rail card is a
// session-picker + form instead of a single button, even though its
// headline/social-proof/divider rhythm otherwise matches GameJoinCard.


const sectionDividerStyle: React.CSSProperties = { height: 1, background: colors.border, margin: "28px 0" };

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function nextSession(e: Experience): ExperienceSessionSlot | null {
  return e.sessions[0] ?? null;
}


function SectionHeading({ title }: { title: string }) {
  return <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 14px" }}>{title}</h2>;
}

// Flat labeled block — heading + paragraph, only rendered if there's real
// content. Same shape GameDetail's own "What to bring" uses.
function InfoBlock({ heading, body }: { heading: string; body: string }) {
  if (!body) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14.5, margin: "0 0 6px" }}>{heading}</h3>
      <p style={{ margin: 0, fontSize: 14, color: colors.muted, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{body}</p>
    </div>
  );
}

// Booking UX Phase 4 — acknowledgement rows (44px target, label wraps the box).
const ackRow: React.CSSProperties = { display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, lineHeight: 1.45, minHeight: 44, cursor: "pointer" };
const ackBox: React.CSSProperties = { width: 20, height: 20, margin: "1px 0 0", flex: "none" };

export function ExperienceDetail() {
  const paidOpen = usePaidCheckoutOpen();
  // Slugs (master-prompt punch list #1) — same convention as centres/clubs;
  // booking submits with experience.id once loaded, never this raw param.
  const { id: idOrSlug } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { resident } = useGuest();
  const [experience, setExperience] = useState<Experience | null>(null);
  // D-01: an experience whose organisation is suspended.
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null);
  usePageTitle(experience?.title);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [similar, setSimilar] = useState<Experience[]>([]);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<ExperienceSessionSlot | null>(null);
  // HC-QA-042 — the amount shown before confirming is the server's own quote
  // (VAT + platform fee included), not a client-side price × party guess.
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  // Stage 5b — the signed-in resident's HelloCircle credit (0 when none / switched off).
  const [creditMinor, setCreditMinor] = useState(0);
  // "unavailable" = the balance couldn't be checked (not the same as €0):
  // credit stays off, card checkout still works, and the person can retry.
  const [creditCheck, setCreditCheck] = useState<"idle" | "ok" | "unavailable">("idle");
  const [creditAttempt, setCreditAttempt] = useState(0);
  const [useCredits, setUseCredits] = useState(false);
  // Stage 5f — coupon at experience checkout (validated by the server quote).
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [form, setForm] = useState({ participantName: "", email: resident?.email ?? "", phone: "", partySize: 1 });
  // Booking UX Phase 4 — names for persons 2..n, the minimum-age declaration
  // and the acknowledgements recorded with the order (server: orderAcknowledgements.ts).
  const [others, setOthers] = useState<string[]>([]);
  const [acks, setAcks] = useState({ minAge: false, safety: false, terms: false });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // DP-41 — the site's form-error pattern: each problem under its field, plus
  // a linked summary that takes focus on a failed submit.
  const fe = useFormErrors();
  const [confirmed, setConfirmed] = useState<{ ref: string } | null>(null);
  // Participation Phase 1 — registration options: quantities chosen per option.
  const [qty, setQty] = useState<OptionQuantities>({});
  const optionsMode = experience?.registration?.mode === "options";
  const registrationOpen = !optionsMode || experience?.registration?.open !== false;
  const regOptions = optionsMode ? experience!.registration!.options : [];
  const optionHeads = headsOf(regOptions, qty);
  const chosenLines = selectedLines(qty);
  const chosenKey = JSON.stringify(chosenLines);
  // With options the head count comes from the options chosen (the server re-derives it).
  const partySize = optionsMode ? Math.max(optionHeads, 1) : form.partySize;
  const linesInput = optionsMode ? { lines: chosenLines } : {};
  // Participation Phase 2 — who is coming and the organiser's questions (while switched on).
  const attendeeDetails = experience?.registration?.attendeeDetails ?? null;
  const slots = useMemo(() => (attendeeDetails ? personSlots(optionsMode ? regOptions : null, qty, partySize) : []), [attendeeDetails, optionsMode, regOptions, qty, partySize]);
  const slotsKey = JSON.stringify(slots);
  const [people, setPeople] = useState<PersonDraft[]>([]);
  const [answers, setAnswers] = useState<AnswersDraft>({ booking: {}, attendees: [] });
  useEffect(() => {
    setPeople((prev) => fitPeople(prev, slots, form.participantName.trim()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsKey]);
  // Person 1 follows the booking name until it's changed on its own.
  const lastContact = useRef("");
  useEffect(() => {
    const name = form.participantName.trim();
    setPeople((prev) => (prev[0] && prev[0].personType === "adult" && (prev[0].name === "" || prev[0].name === lastContact.current) ? [{ ...prev[0], name }, ...prev.slice(1)] : prev));
    lastContact.current = name;
  }, [form.participantName]);

  const load = () => {
    if (!idOrSlug) return;
    setLoadError(false);
    setDescriptionExpanded(false);
    fetchExperience(idOrSlug)
      .then((x) => (isUnavailable(x) ? setUnavailable(x) : setExperience(x)))
      // PUB-14: a removed listing shows "no longer available", not a retry.
      .catch((e) => (isNotFound(e) ? setExperience(null) : setLoadError(true)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [idOrSlug]);

  useEffect(() => {
    if (resident?.email) setForm((f) => ({ ...f, email: resident.email }));
  }, [resident]);

  useEffect(() => {
    if (!experience) return;
    fetchExperiences(experience.kind)
      .then((rows) => {
        const others = rows.filter((r) => r.id !== experience.id);
        others.sort((a, b) => (a.county === experience.county ? -1 : 0) - (b.county === experience.county ? -1 : 0));
        setSimilar(others.slice(0, 4));
      })
      .catch(() => setSimilar([]));
  }, [experience]);

  useEffect(() => {
    if (!experience || !selectedSession || (optionsMode ? optionHeads === 0 || !registrationOpen : !experience.priceCents)) {
      setQuote(null);
      return;
    }
    let live = true;
    quoteExperienceSession(experience.id, selectedSession.id, { partySize, useCredits, couponCode: appliedCoupon ?? undefined, ...linesInput })
      .then((q) => {
        if (!live) return;
        setQuote(q);
        if (optionsMode) setError(null);
      })
      .catch((e) => {
        if (!live) return;
        setQuote(null);
        // Participation Phase 1 — an option that sold out or closed while choosing.
        if (optionsMode && e instanceof ApiError && /^(lines_|registration_)/.test(String(e.body.code ?? ""))) setError(e.message);
        // A coupon that stopped applying (e.g. party size below its minimum spend) is dropped, with the reason.
        if (appliedCoupon && e instanceof ApiError && String(e.body.code ?? "").startsWith("coupon_")) {
          setAppliedCoupon(null);
          setCouponError(couponMessage(String(e.body.code), e.message));
        }
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experience, selectedSession, form.partySize, useCredits, appliedCoupon, chosenKey]);

  const applyCoupon = async () => {
    if (!experience || !selectedSession) return;
    const code = couponInput.trim();
    if (!code) return;
    setCouponError(null);
    try {
      const q = await quoteExperienceSession(experience.id, selectedSession.id, { partySize, useCredits, couponCode: code, ...linesInput });
      setAppliedCoupon(q.couponCode ?? code);
      setQuote(q);
      trackTypedEvent(AnalyticsEvent.CouponApplied);
    } catch (e) {
      const code2 = e instanceof ApiError ? String(e.body.code ?? "") : "";
      setCouponError(couponMessage(code2, e instanceof Error ? e.message : "That code couldn't be applied"));
      const reason = code2.replace("coupon_", "");
      trackTypedEvent(AnalyticsEvent.CouponRejected, { reason: reason === "invalid" || reason === "expired" || reason === "limit" || reason === "not_applicable" ? reason : "other" });
    }
  };

  useEffect(() => {
    if (!resident) {
      setCreditMinor(0);
      setCreditCheck("idle");
      return;
    }
    fetchMyCredits()
      .then((c) => {
        setCreditMinor(c.enabled ? c.balanceMinor : 0);
        setCreditCheck("ok");
      })
      .catch(() => {
        setCreditMinor(0);
        setUseCredits(false);
        setCreditCheck("unavailable");
      });
  }, [resident, creditAttempt]);

  const photos = useMemo(() => (experience ? [experience.imageUrl, ...experience.images].filter(Boolean) : []), [experience]);

  const submit = async () => {
    if (!experience || !selectedSession) return;
    const extraNames = Array.from({ length: partySize - 1 }, (_, i) => (others[i] ?? "").trim());
    const problems: FormError[] = [];
    if (optionsMode && optionHeads === 0) problems.push({ field: "options", message: "Choose at least one option" });
    if (!form.participantName.trim()) problems.push({ field: "name", fieldId: "exp-name", message: isVolunteer ? "Enter your name" : "Enter a name for the booking" });
    if (attendeeDetails) {
      people.forEach((p, i) => {
        if (!p.name.trim()) problems.push({ field: `person-${i + 1}`, fieldId: `exp-person-${i + 1}`, message: `Enter a name for person ${i + 1}` });
        if (p.personType === "child" && p.guardian === "") problems.push({ field: `guardian-${i + 1}`, fieldId: `exp-guardian-${i + 1}`, message: `Say who looks after ${p.name.trim() || `person ${i + 1}`}` });
      });
      for (const m of missingAnswers(attendeeDetails.questions, people, withDefaults(attendeeDetails.questions, people, answers))) problems.push({ field: m.fieldId, fieldId: m.fieldId, message: m.message });
    } else {
      extraNames.forEach((n, i) => {
        if (!n) problems.push({ field: `person-${i + 2}`, fieldId: `exp-person-${i + 2}`, message: `Enter a name for person ${i + 2}` });
      });
    }
    if (!isValidEmail(form.email)) problems.push({ field: "email", fieldId: "exp-email", message: "Enter an email address like name@example.ie" });
    if (experience.minAge && !acks.minAge) problems.push({ field: "minAge", fieldId: "exp-ack-minage", message: `Confirm everyone taking part is at least ${experience.minAge}` });
    if (experience.safetyInfo.trim() && !acks.safety) problems.push({ field: "safety", fieldId: "exp-ack-safety", message: "Confirm you've read the safety information" });
    if (!acks.terms) problems.push({ field: "terms", fieldId: "exp-ack-terms", message: "Tick the box to agree to the booking terms" });
    if (problems.length) {
      setError(null);
      fe.fail(problems);
      return;
    }
    fe.clear();
    setError(null);
    setSubmitting(true);
    try {
      // Commerce Engine Phase 2 — hand back the quote the customer was shown;
      // the server refuses (409) rather than charging a price that moved.
      const quoteId = quote && quote.partySize === partySize ? quote.quoteId : undefined;
      const res = await bookExperienceSession(experience.id, selectedSession.id, {
        ...form,
        partySize,
        ...linesInput,
        quoteId,
        useCredits,
        couponCode: appliedCoupon ?? undefined,
        participants: attendeeDetails ? people.map((p) => p.name.trim()) : [form.participantName.trim(), ...extraNames],
        ...(attendeeDetails
          ? {
              attendees: toAttendeeInput(people),
              answers: withDefaults(attendeeDetails.questions, people, answers),
              questionsVersion: attendeeDetails.questionsVersion,
            }
          : {}),
        meetsMinAge: experience.minAge ? acks.minAge : undefined,
        acceptedSafety: acks.safety,
        acceptedTerms: acks.terms,
      });
      if (useCredits && quote?.creditCents) trackTypedEvent(AnalyticsEvent.CreditApplied, { coversAll: quote.totalCents === 0 });
      if (res.url) {
        openCheckout(res.url);
        return;
      }
      setBookingOpen(false);
      setConfirmed({ ref: res.ref });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't complete booking");
      // The price moved or the quote went stale: show the current total so
      // the customer can review it and try again.
      const code = e instanceof ApiError ? e.body.code : undefined;
      // The organiser changed the questions while the form was open: load them again.
      if (code === "questions_changed") load();
      if (typeof code === "string" && (code.startsWith("quote_") || code === "price_changed")) {
        quoteExperienceSession(experience.id, selectedSession.id, { partySize, useCredits, couponCode: appliedCoupon ?? undefined, ...linesInput }).then(setQuote).catch(() => setQuote(null));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSpinner />;

  // Product Language & IA Polish — Changeset 1F. Before the experience has
  // (or ever) loads, `experience.kind` isn't known — these two error states
  // used to default to "adventure" phrasing unconditionally, which was
  // wrong whenever someone landed here via /experiences/:id. The route
  // itself (mounted separately at /adventures/:id and /experiences/:id,
  // see App.tsx) is a real, always-available signal for which one they
  // actually meant, so use that instead of a hardcoded default.
  const isAdventureRoute = experience ? experience.kind === "adventure" : location.pathname.startsWith("/adventures");
  const isEventRoute = experience ? experience.kind === "event" : location.pathname.startsWith("/events");
  const browsePath = isAdventureRoute ? "/adventures" : isEventRoute ? "/events" : "/experiences";
  const browseLabel = isAdventureRoute ? "All adventures" : isEventRoute ? "All events" : "All experiences";
  const kindNoun = isAdventureRoute ? "adventure" : isEventRoute ? "event" : "experience";

  if (loadError) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px, 2.4vw, 30px)", margin: "0 0 10px" }}>We couldn't load this {kindNoun}.</h1>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
          <Button onClick={load}>Try again</Button>
          <Button variant="ghost" onClick={() => navigate(browsePath)}>Browse listings</Button>
        </div>
      </section>
    );
  }

  if (unavailable) return <UnavailableListing item={unavailable} />;
  if (!experience) return <DetailUnavailable noun={kindNoun} listPath={browsePath} listLabel={`Browse ${kindNoun}s`} />;

  if (confirmed) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "56px 24px 64px", display: "grid", gap: 20 }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "clamp(32px, 3.8vw, 52px)", margin: 0, textAlign: "center" }}>{experience.kind === "volunteer" ? "You're signed up." : "You're booked."}</h1>
        {/* The pass (owner 2026-10-27): a ticket; volunteering gets the
            lanyard look. Then the icons, then one main action. */}
        <Pass
          look={experience.kind === "volunteer" ? "lanyard" : "ticket"}
          kind={experience.kind === "adventure" ? "adventure" : experience.kind === "volunteer" ? "volunteer" : experience.kind === "event" ? "event" : "experience"}
          tone="ok"
          status={experience.kind === "volunteer" ? "Signed up" : experience.priceCents && experience.paymentMethod === "cash" ? "Booked · pay on the day" : "Booked"}
          title={experience.title}
          who={form.participantName.trim() || null}
          date={selectedSession ? passDate(selectedSession.date) : null}
          time={selectedSession ? passTime(selectedSession.time, experience.durationMinutes) : null}
          where={experience.meetingPoint || [experience.area, experience.county].filter(Boolean).join(", ")}
          fields={[
            ["People", String(partySize)],
            ...(experience.priceCents && experience.paymentMethod === "cash" ? ([["Pay", `${formatPrice(optionsMode && quote ? quote.totalCents : experience.priceCents * form.partySize)} cash`]] as [string, string][]) : []),
            ...(experience.equipmentRequired ? ([["Bring", experience.equipmentRequired]] as [string, string][]) : []),
          ].slice(0, 4) as [string, string][]}
          reference={confirmed.ref}
        >
          <BookingActions>
            <IconAction label="Add to calendar" short="Calendar" onClick={() => downloadExperienceBookingIcs(confirmed.ref)}><CalendarIcon size={18} /></IconAction>
            <InviteSheetButton entityType={experience.kind === "adventure" ? "adventure" : "experience"} entityId={experience.id} title={experience.title} render={(open) => <IconAction label="Invite someone" short="Invite" onClick={open}><UsersIcon size={18} /></IconAction>} />
            <IconAction label="Directions" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${experience.meetingPoint || experience.title}, ${experience.area}, ${experience.county}`)}`}><PinIcon size={18} /></IconAction>
          </BookingActions>
        </Pass>
        <Button full onClick={() => navigate("/bookings")}>View my bookings</Button>
      </section>
    );
  }

  const session = nextSession(experience);
  const joined = session ? Math.max(0, session.capacity - session.spotsLeft) : 0;
  const full = session ? session.spotsLeft === 0 : false;
  const description = experience.description || "";
  const descriptionIsLong = description.length > 320;
  const visibleDescription = descriptionExpanded || !descriptionIsLong ? description : `${description.slice(0, 320).trimEnd()}…`;
  const isVolunteer = experience.kind === "volunteer";
  const kindLabel = experience.kind === "adventure" ? "Adventure" : isVolunteer ? "Volunteer" : experience.kind === "event" ? "Event" : "Experience";
  const kindAccent = experience.kind === "adventure" ? colors.green : colors.orange;
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${experience.meetingPoint || experience.title}, ${experience.area}, ${experience.county}`)}`;

  const similarPath = experience.taxonomy ? `${browsePath}?category=${experience.taxonomy.categorySlug}${experience.taxonomy.subcategorySlug ? `&sub=${experience.taxonomy.subcategorySlug}` : ""}` : browsePath;
  // At a glance (owner 2026-10-27): only what the provider filled in.
  const glance: GlanceItem[] = [];
  if (experience.durationMinutes || experience.difficulty)
    glance.push({
      key: "length",
      icon: <ClockIcon size={16} />,
      value: experience.durationMinutes ? formatDuration(experience.durationMinutes) : experience.difficulty,
      sub: experience.durationMinutes ? experience.difficulty || undefined : undefined,
    });
  if (experience.equipmentRequired) glance.push({ key: "bring", icon: <ShieldIcon size={16} />, value: "Bring", sub: experience.equipmentRequired });
  else if (experience.equipmentProvided) glance.push({ key: "provided", icon: <ShieldIcon size={16} />, value: "Provided", sub: experience.equipmentProvided });
  if (experience.sessions.length > 0) glance.push({ key: "cancel", icon: <CalendarIcon size={16} />, value: "Cancellation", sub: experience.cancellationTerms || "plans can change, check here before you go" });

  const safetyLines = experience.safetyInfo.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  const joinHeadline = !session
    ? "No dates yet"
    : full
    ? "Full"
    : isVolunteer
    ? // "18 joining · 6 more volunteers needed" — aggregate counts only.
      `${joined} joining · ${session.spotsLeft} more volunteer${session.spotsLeft === 1 ? "" : "s"} needed`
    : session.spotsLeft === 1
    ? "1 spot left"
    : `${session.spotsLeft} spots left`;
  const joinHeadlineColor = !session ? colors.muted : full ? colors.muted : session.spotsLeft <= 3 ? colors.orangeDark : colors.text;
  const anyAvailable = experience.sessions.some((s) => s.spotsLeft > 0);
  const registerLabel = experience.kind === "adventure" ? "Book this adventure" : isVolunteer ? "Volunteer" : experience.kind === "event" ? "Register for this event" : "Register for this experience";
  // The step-2 submit verb ("Book"/"Register") tracks the same per-kind
  // choice as `registerLabel` above, so a free experience's flow doesn't
  // open on "Register for this experience" and then submit as "Book for
  // free" — same action, same verb, both steps.
  const submitVerb = experience.kind === "adventure" ? "Book" : isVolunteer ? "Sign up to volunteer" : "Register";

  // Booking popup — two short steps instead of one long scroll: pick a date
  // (tapping one moves on), then your details, with the total and the pay
  // button pinned in the footer so they're always visible. A single-date
  // listing skips straight to step 2 (see openBooking).
  // > 0 ⇔ a paid booking (labels only). With options: whether anything chosen has a price.
  const bookingTotalCents = optionsMode ? (regOptions.some((o) => (qty[o.id] ?? 0) > 0 && o.priceMinor > 0) ? 1 : 0) : experience.priceCents * form.partySize;
  const quotedTotal = quote && quote.partySize === partySize ? quote.totalCents : null;
  const bookingDirty = !!selectedSession && (form.participantName.trim() !== "" || form.phone.trim() !== "" || form.partySize > 1 || chosenLines.length > 0);
  const priceSummary = optionsMode ? (quote?.lines ?? []).map((l) => `${l.label} × ${l.quantity}`).join(" · ") : `${form.partySize} × €${(experience.priceCents / 100).toFixed(2)}`;
  const openBooking = () => {
    const available = experience.sessions.filter((s) => s.spotsLeft > 0);
    if (available.length === 1) setSelectedSession(available[0]);
    setError(null);
    setBookingOpen(true);
  };

  const bookingSubtitle = selectedSession
    ? `${dateLabel(selectedSession.date)} · ${selectedSession.time}`
    : `Step 1 of 2 · choose a date`;

  const bookingBody = !selectedSession ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {experience.sessions.map((s) => {
        const sFull = s.spotsLeft === 0;
        return (
          <Fragment key={s.id}>
          <button
            onClick={() => !sFull && setSelectedSession(s)}
            disabled={sFull}
            style={{
              textAlign: "left",
              background: colors.surface,
              border: `1.5px solid ${colors.border}`,
              borderRadius: radius.control,
              padding: "14px 16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              cursor: sFull ? "default" : "pointer",
              opacity: sFull ? 0.55 : 1,
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontWeight: 700, fontSize: 14.5, color: colors.text }}>{dateLabel(s.date)}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: colors.muted }}>
                <ClockIcon size={13} /> {s.time}
              </span>
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: sFull ? colors.muted : s.spotsLeft <= 3 ? colors.orangeDark : colors.greenText, flex: "none" }}>
              {sFull ? "Full" : `${s.spotsLeft} left`}
            </span>
          </button>
          {sFull && (
            <div style={{ margin: "-2px 0 6px 4px" }}>
              <SpotAlertButton experienceId={experience.id} sessionId={s.id} />
            </div>
          )}
          </Fragment>
        );
      })}
      {experience.sessions.length === 0 && <p style={{ color: colors.faint, fontSize: 13.5, margin: 0 }}>No upcoming departures scheduled yet.</p>}
    </div>
  ) : (
    <>
      {experience.sessions.filter((s) => s.spotsLeft > 0).length > 1 && (
        <button
          onClick={() => setSelectedSession(null)}
          style={{ background: "none", border: "none", padding: 0, marginBottom: 16, fontSize: 13, fontWeight: 700, color: colors.muted, cursor: "pointer", textDecoration: "underline" }}
        >
          ← Choose a different date
        </button>
      )}
      <FormErrorSummary errors={fe.errors} focusKey={fe.focusKey} />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label htmlFor="exp-name" style={labelStyle}>{isVolunteer ? "Your name" : "Name for the booking"}</label>
          <input {...fe.control("exp-name")} autoComplete="name" value={form.participantName} onChange={(e) => setForm((f) => ({ ...f, participantName: e.target.value }))} style={inputStyle} />
          <FieldError fieldId="exp-name" message={fe.messageFor("exp-name")} />
        </div>
        {optionsMode ? (
          registrationOpen ? (
            <OptionPicker options={regOptions} qty={qty} onChange={(next) => { setQty(next); fe.clearField("options"); }} left={selectedSession.optionsLeft} placesLeft={selectedSession.spotsLeft} />
          ) : (
            <p role="status" style={{ margin: 0, padding: "10px 12px", background: colors.panel, borderRadius: radius.control, fontSize: 13.5 }}>
              Registration for this {kindNoun} is paused for now. Please check back soon.
            </p>
          )
        ) : (
          <NumberStepper
            label={isVolunteer ? "How many volunteers" : "Party size"}
            value={form.partySize}
            onChange={(n) => setForm((f) => ({ ...f, partySize: n }))}
            min={1}
            max={selectedSession.spotsLeft}
          />
        )}
        {attendeeDetails && registrationOpen && people.length > 0 && (
          <AttendeeFields slots={slots} people={people} onPeople={setPeople} questions={attendeeDetails.questions} answers={answers} onAnswers={setAnswers} contactName={form.participantName.trim()} fe={fe} />
        )}
        {!attendeeDetails && partySize > 1 &&
          Array.from({ length: partySize - 1 }, (_, i) => (
            <div key={i}>
              <label htmlFor={`exp-person-${i + 2}`} style={labelStyle}>
                Name for person {i + 2}
              </label>
              <input
                {...fe.control(`exp-person-${i + 2}`)}
                autoComplete="off"
                value={others[i] ?? ""}
                onChange={(e) => setOthers((o) => Object.assign([...o], { [i]: e.target.value }))}
                style={inputStyle}
              />
              <FieldError fieldId={`exp-person-${i + 2}`} message={fe.messageFor(`exp-person-${i + 2}`)} />
            </div>
          ))}
        <div>
          <label htmlFor="exp-email" style={labelStyle}>Email</label>
          <input {...fe.control("exp-email")} type="email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={inputStyle} />
          <FieldError fieldId="exp-email" message={fe.messageFor("exp-email")} />
          <div style={{ fontSize: 12, color: colors.faint, marginTop: 4 }}>We'll send your confirmation here.</div>
        </div>
        <div>
          <label htmlFor="exp-phone" style={labelStyle}>Phone (optional)</label>
          <input id="exp-phone" type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} style={inputStyle} />
        </div>
      </div>
      {!!experience?.priceCents && (
        <div style={{ marginTop: 14 }}>
          <label htmlFor="exp-coupon" style={labelStyle}>Coupon code (optional)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="exp-coupon"
              value={appliedCoupon ?? couponInput}
              disabled={!!appliedCoupon}
              onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyCoupon())}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
              aria-describedby={couponError ? "exp-coupon-error" : undefined}
              aria-invalid={!!couponError}
            />
            {appliedCoupon ? (
              <Button variant="ghost" onClick={() => { setAppliedCoupon(null); setCouponInput(""); }}>Remove</Button>
            ) : (
              <Button variant="ghost" onClick={applyCoupon} disabled={!couponInput.trim() || !selectedSession}>Apply</Button>
            )}
          </div>
          {couponError && <p id="exp-coupon-error" role="alert" style={{ color: colors.danger, fontSize: 13, margin: "6px 0 0" }} data-testid="coupon-error">{couponError}</p>}
        </div>
      )}
      {creditCheck === "unavailable" && !!experience?.priceCents && (
        <p role="status" style={{ fontSize: 13, color: colors.textSoft, margin: "14px 0 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          We couldn't check your HelloCircle credit just now, so none is applied. You can still book and pay by card.
          <button type="button" onClick={() => setCreditAttempt((n) => n + 1)} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, textDecoration: "underline", cursor: "pointer", font: "inherit", fontSize: 13 }}>
            Check again
          </button>
        </p>
      )}
      {creditMinor > 0 && !!experience?.priceCents && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, marginTop: 14 }}>
          <input type="checkbox" checked={useCredits} onChange={(e) => setUseCredits(e.target.checked)} />
          <span>Use my HelloCircle credit (€{(creditMinor / 100).toFixed(2)} available)</span>
        </label>
      )}
      {paidOpen === false && !!experience?.priceCents && experience.paymentMethod !== "cash" && (
        <p role="status" style={{ fontSize: 13.5, fontWeight: 600, color: colors.orangeDark, background: colors.orangeBg, borderRadius: radius.control, padding: "10px 12px", margin: "14px 0 0" }}>
          {PAID_CLOSED_MESSAGE}
        </p>
      )}
      {/* Shown whenever something is priced before discounts — including a paid
          booking that coupon + credit bring to €0 ("nothing to pay"); hidden only
          for an all-free choice of options. */}
      {quote && (optionsMode ? quote.subtotalCents > 0 : !!experience?.priceCents) && <CheckoutBreakdown quote={quote} unitPriceCents={experience.priceCents} />}
      <fieldset style={{ border: "none", margin: "16px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <legend style={{ ...labelStyle, padding: 0 }}>Before you book</legend>
        {!!experience.minAge && (
          <>
          <label style={ackRow}>
            <input type="checkbox" id="exp-ack-minage" aria-invalid={fe.messageFor("exp-ack-minage") ? true : undefined} aria-describedby={fe.messageFor("exp-ack-minage") ? "exp-ack-minage-error" : undefined} checked={acks.minAge} onChange={(e) => { setAcks((a) => ({ ...a, minAge: e.target.checked })); fe.clearField("exp-ack-minage"); }} style={ackBox} />
            <span>Everyone taking part is at least {experience.minAge}</span>
          </label>
          <FieldError fieldId="exp-ack-minage" message={fe.messageFor("exp-ack-minage")} />
          </>
        )}
        {!!experience.safetyInfo.trim() && (
          <>
          <label style={ackRow}>
            <input type="checkbox" id="exp-ack-safety" aria-invalid={fe.messageFor("exp-ack-safety") ? true : undefined} aria-describedby={fe.messageFor("exp-ack-safety") ? "exp-ack-safety-error" : undefined} checked={acks.safety} onChange={(e) => { setAcks((a) => ({ ...a, safety: e.target.checked })); fe.clearField("exp-ack-safety"); }} style={ackBox} />
            <span>I've read the safety information for this {isVolunteer ? "opportunity" : "trip"} and will share it with my group</span>
          </label>
          <FieldError fieldId="exp-ack-safety" message={fe.messageFor("exp-ack-safety")} />
          </>
        )}
        <label style={ackRow}>
          <input type="checkbox" id="exp-ack-terms" aria-invalid={fe.messageFor("exp-ack-terms") ? true : undefined} aria-describedby={fe.messageFor("exp-ack-terms") ? "exp-ack-terms-error" : undefined} checked={acks.terms} onChange={(e) => { setAcks((a) => ({ ...a, terms: e.target.checked })); fe.clearField("exp-ack-terms"); }} style={ackBox} />
          <span>
            I agree to the <Link to="/policies/customer-booking-terms" target="_blank">booking terms</Link> and this listing's cancellation terms
          </span>
        </label>
        <FieldError fieldId="exp-ack-terms" message={fe.messageFor("exp-ack-terms")} />
      </fieldset>
      {error && (
        <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: "14px 0 0" }}>
          {error}
        </p>
      )}
    </>
  );

  const bookingFooter = selectedSession ? (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: bookingTotalCents ? colors.text : colors.greenText }} data-testid="booking-total">
          {bookingTotalCents ? (quotedTotal !== null ? `€${(quotedTotal / 100).toFixed(2)}` : "…") : optionsMode && optionHeads === 0 ? "—" : "Free"}
        </div>
        <div style={{ fontSize: 12, color: colors.mutedLight }}>
          {bookingTotalCents
            ? quote && quotedTotal !== null
              ? quote.vatIncluded
                ? `${priceSummary} · incl. VAT €${(quote.vatCents / 100).toFixed(2)}${quote.platformFeeCents ? ` + fee €${(quote.platformFeeCents / 100).toFixed(2)}` : ""}`
                : `${priceSummary} + VAT €${(quote.vatCents / 100).toFixed(2)} + fee €${(quote.platformFeeCents / 100).toFixed(2)}`
              : "Calculating total…"
            : optionsMode && optionHeads === 0
            ? "Choose your options"
            : "No payment required"}
        </div>
      </div>
      <Button onClick={submit} disabled={submitting || (optionsMode && (!registrationOpen || optionHeads === 0)) || (paidOpen === false && !!bookingTotalCents && quotedTotal !== 0 && experience.paymentMethod !== "cash")} style={{ flex: "none" }}>
        {submitting ? "Please wait…" : bookingTotalCents && quotedTotal !== 0 ? "Continue to pay" : submitVerb}
      </Button>
    </div>
  ) : undefined;

  return (
    <div className="experience-detail-mobile-pad fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 90px" }}>
        <DetailTopBar
          backTo={browsePath}
          backLabel={browseLabel}
          extra={<ListingChatButton scopeType="experience_session" listingId={experience.id} style={detailActionStyle} />}
          share={{ entityType: experience.kind === "adventure" ? "adventure" : "experience", entityId: experience.id }}
          save={{ kind: "experience", id: experience.id }}
          report={{ type: "experience", id: experience.id, what: "this listing" }}
        />

        {/* Detail-page redesign: 70/30 — head and body left, booking column right;
            on phones the booking column follows the head. */}
        <div className="detail-grid">
          <div className="detail-head">
            {/* HERO — same badge-overlaid Photo treatment as GameDetail's own
                hero: date/time pill top-left, spots-left pill top-right,
                height 340 / radius 20. A small dot selector below (not a
                thumbnail grid) is the one addition, since unlike a Game an
                Experience/Adventure can carry several real photos. */}
            {/* Batch 2 — the shared cover: several photos slide in the same frame
                (swipe, arrows, dots, counter, full-screen viewer). */}
            <PhotoGallery
              images={photos}
              alt={experience.title}
              ph={experience.kind === "adventure" ? colors.greenBg : colors.orangeBg}
              icon={<TreeIconSmall size={40} />}
              iconColor={kindAccent}
              style={{ marginBottom: 24 }}
              overlay={<>
              {session ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: photoOverlay.whiteBg, color: colors.text, borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 700 }}>
                  <CalendarIcon size={13} /> {dateLabel(session.date)} · {session.time}
                </span>
              ) : <span />}
              {/* Availability lives in the booking panel; the cover only flags "Full". */}
              {session && full && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 700, background: photoOverlay.whiteBg, color: colors.muted }}>
                  Full
                </span>
              )}
              </>}
            />

            <div style={{ marginBottom: 8 }}>
              <CategoryBreadcrumb
                taxonomy={experience.taxonomy}
                tags={experience.tags}
                basePath={experience.kind === "adventure" ? "/adventures" : experience.kind === "volunteer" ? "/volunteer" : experience.kind === "event" ? "/events" : "/experiences"}
                typeLabel={experience.kind === "adventure" ? "Adventures" : experience.kind === "volunteer" ? "Volunteering" : experience.kind === "event" ? "Events" : "Experiences"}
              />
            </div>
            {/* Eyebrow (kind) + title + price row — same position/weight as
                GameDetail's own eyebrow/title/price row. */}
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>
              {kindLabel}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(32px, 3.8vw, 52px)", margin: 0, letterSpacing: 0 }}>{experience.title}</h1>
              <div style={{ flex: "none" }}>

              </div>
            </div>
            {experience.blurb && !description.trim().startsWith(experience.blurb.trim().slice(0, 40)) && <p style={{ margin: "6px 0 0", fontSize: 15, color: colors.mutedLight, lineHeight: 1.5 }}>{experience.blurb}</p>}
            {/* When and where, once, under the title (owner 2026-10-27, booking
                box option 2): the booking box no longer repeats them. */}
            <div className="detail-when-where">
              {session && (
                <span>
                  <CalendarIcon size={15} />
                  <b>{dateLabel(session.date)} · {session.time}</b>
                  {experience.durationMinutes ? <> · {formatDuration(experience.durationMinutes)}</> : null}
                  {experience.sessions.length > 1 ? <> · next of {experience.sessions.length} dates</> : null}
                </span>
              )}
              <span>
                <PinIcon size={15} />
                <b>{experience.meetingPoint || [experience.area, experience.county].filter(Boolean).join(", ")}</b>
                {experience.meetingPoint && [experience.area, experience.county].filter(Boolean).length ? <>, {[experience.area, experience.county].filter(Boolean).join(", ")}</> : null}
                {" · "}
                <a href={directionsHref([experience.meetingPoint, experience.area, experience.county].filter(Boolean).join(", "), experience.lat, experience.lng)} target="_blank" rel="noreferrer">
                  Directions
                </a>
              </span>
            </div>
            {experience.vendorName && <div style={{ color: colors.mutedLight, fontSize: 14, marginTop: 4 }}>Hosted by {experience.vendorName}</div>}
            <KeyFacts
              facts={[
                experience.durationMinutes > 0 && { icon: <ClockIcon size={17} />, value: formatDuration(experience.durationMinutes), label: "Duration" },
                experience.distanceKm !== null && { icon: <PinIcon size={17} />, value: `${experience.distanceKm} km`, label: "Distance" },
                experience.elevationGainM !== null && { icon: <TrendUpIcon size={17} />, value: `${experience.elevationGainM} m`, label: "Elevation gain" },
                !isVolunteer && !!experience.difficulty && { icon: <TrendUpIcon size={17} />, value: capitalize(experience.difficulty), label: "Difficulty" },
                { icon: <UsersIcon size={17} />, value: isVolunteer ? String(experience.capacity) : `Up to ${experience.capacity}`, label: isVolunteer ? "Volunteers needed" : "Group size" },
                !!experience.minAge && { icon: <PersonIcon size={17} />, value: `${experience.minAge}+`, label: "Minimum age" },
                !!experience.terrainType && { icon: <TreeIconSmall size={17} />, value: experience.terrainType, label: "Terrain" },
                isVolunteer && !!experience.cause && { icon: <HeartIcon size={17} />, value: experience.cause, label: "Cause" },
              ]}
            />

            <ParticipationBlock attributes={experience.participationAttributes} />
            <OfficialCircleLink circleId={experience.circleId} circleName={experience.circleName} circleSlug={experience.circleSlug} />

            {experience.meetingPoint && (experience.lat === null || experience.lng === null) && (
              <div style={{ background: colors.greenBg, color: colors.greenText, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5, margin: "16px 0" }}>
                <strong>Meeting point:</strong> {experience.meetingPoint}
              </div>
            )}
            {!session && (
              <div style={{ background: colors.panel, color: colors.muted, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5, margin: "16px 0" }}>
                No upcoming departures scheduled yet — check back soon.
              </div>
            )}

          </div>

          <div className="detail-body">
            <div style={sectionDividerStyle} />

            {description && (
              <div style={{ marginBottom: 28 }}>
                <SectionHeading title={`About this ${experience.kind}`} />
                <p style={{ margin: 0, fontSize: 15, color: colors.textSoft, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{visibleDescription}</p>
                {descriptionIsLong && (
                  <button
                    onClick={() => setDescriptionExpanded((v) => !v)}
                    style={{ background: "none", border: "none", padding: 0, marginTop: 8, color: colors.text, fontWeight: 700, fontSize: 13.5, cursor: "pointer", textDecoration: "underline" }}
                  >
                    {descriptionExpanded ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
            )}

            {/* Trust & Retention — one "What to expect" list (fitness, requirements,
                kit, getting there, weather, accessibility, newcomers…): every field
                shown, empty ones as "Not provided", irrelevant ones "Not applicable". */}
            <WhatToExpect facts={experienceExpectFacts(experience)} contact="Message the organiser from this page, or" />

            <InfoBlock heading="Itinerary" body={experience.itinerary} />

            {/* Hosted by — the real vendor behind this listing (businessName-
                or-name + a verified badge off provider_tier), linking to
                their public provider profile. Adventures/Experiences are
                vendor-listed, not resident-hosted like a Game, so this is a
                business, not a person — deliberately not styled like a
                personal host avatar. */}

            {/* Meeting point — same bordered-row + map pattern GameLocationCard uses. */}

            {/* Safety & preparation — the vendor's own safetyInfo text, shown
                as a checklist when entered line-by-line, prose otherwise.
                Nothing here is a generic fabricated checklist. */}
            {safetyLines.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionHeading title="Safety & preparation" />
                {safetyLines.length > 1 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {safetyLines.map((line, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 14, color: colors.textSoft, lineHeight: 1.5 }}>
                        <CheckIcon size={14} style={{ color: colors.greenText, flex: "none", marginTop: 3 }} /> {line}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 14, color: colors.textSoft, lineHeight: 1.6 }}>{safetyLines[0]}</p>
                )}
              </div>
            )}

            {/* Reviews — real, listing-eligibility-gated like every other
                Reviews usage in the app (see Reviews.tsx); a guest can only
                post once they've actually got a past paid booking on this
                listing (server-checked in reviews.ts, not just hidden UI). */}
            <div style={{ marginBottom: 28 }}>
              <Reviews listingType="experience" listingId={experience.id} accent={experience.kind === "adventure" ? "green" : "orange"} followAfter={experience.vendorId ? { type: "vendor", id: experience.vendorId, name: experience.vendorName } : undefined} />
              <div style={{ marginTop: 20 }}>
                <TraderInfo type="experience" id={experience.id} />
              </div>
            </div>

            {/* Related listings */}
            <ExploreWithOthers taxonomy={experience.taxonomy} county={experience.county} noun={kindNoun} excludeCircleId={experience.circleId} />
            {similar.length > 0 && (
              <div>
                <SectionHeading title="More like this" />
                {/* The shared photo card (owner 2026-10-27), same as every "More like this". */}
                <div className="lc-grid--b" style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 6 }}>
                  {similar.map((e) => (
                    <div key={e.id} style={{ flex: "none", width: 260, display: "flex" }}>
                      <ExperienceCard e={e} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN — sticky Join card, mirroring GameJoinCard's own
              headline / social-proof / divider / info / CTA rhythm. Booking
              itself (session picker + form) lives in a centred popup (Modal),
              opened by the CTA button below, rather than sitting inline in
              this card. */}
          <div className="detail-aside">
            <Card>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: 0, color: joinHeadlineColor }}>{joinHeadline}</h2>
                {session && (startsIn(session.date, session.time) || joined > 0) && (
                  <p style={{ margin: "4px 0 0", fontSize: 13.5, color: colors.mutedLight }}>
                    {[startsIn(session.date, session.time), joined > 0 ? `${joined} of ${session.capacity} going` : null].filter(Boolean).join(" · ")}
                  </p>
                )}
                {!session && <p style={{ margin: "4px 0 0", fontSize: 13.5, color: colors.mutedLight }}>The host hasn't added a date. We can tell you when they do.</p>}
              </div>

              <div style={{ height: 1, background: colors.border, margin: "0 0 16px" }} />

              <BookingGlance items={glance} />

              {/* No dates yet: the price still shows (owner 2026-10-27), so
                  people know what it costs before asking to hear about dates. */}
              <BookingFacts
                  // Date and place live under the title (owner 2026-10-27).
                  facts={[
                    {
                      key: "price",
                      label: "Price",
                      icon: <Euro size={18} strokeWidth={2} />,
                      // Participation Phase 1 — with options the cheapest is a "from" price; each option's own basis shows when booking.
                      value: optionsMode ? <BookingPrice cents={experience.priceCents} unit={experience.priceCents ? "from · several options" : undefined} /> : <BookingPrice cents={experience.priceCents} unit="per person" />,
                      sub: experience.priceCents ? `${PAID_PRICE_NOTE} · ${experience.paymentMethod === "cash" ? "paid in cash on the day" : "paid online when you book"}` : undefined,
                      emphasis: experience.priceCents ? "price" : "free",
                    },
                  ]}
                />

              {anyAvailable ? (
                <Button full onClick={openBooking}>{registerLabel}</Button>
              ) : experience.sessions.length === 0 ? (
                // No dates yet: pick the days and times that suit, right here.
                <IntentCaptureForm variant="box" activityLabel={experience.title} county={experience.county ?? ""} />
              ) : (
                <Button full variant="ghost" onClick={() => scrollToInterest("experience-cta-title")}>Tell me about new dates</Button>
              )}
              {/* Experience 3.0 — every date is full: offer a spot alert per departure. */}
              {!anyAvailable && experience.sessions.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {experience.sessions.slice(0, 4).map((s) => (
                    <div key={s.id} style={{ fontSize: 13 }}>
                      <div style={{ fontWeight: 700 }}>{dateLabel(s.date)} · {s.time} · Full</div>
                      <SpotAlertButton experienceId={experience.id} sessionId={s.id} />
                    </div>
                  ))}
                </div>
              )}
              {anyAvailable && !experience.priceCents && (
                <div style={{ textAlign: "center", fontSize: 12, color: colors.faint, marginTop: 8 }}>No payment required</div>
              )}
              <div style={{ marginTop: 12 }}>
                <BookingActions>
                  <ShareButton entityType={experience.kind === "adventure" ? "adventure" : "experience"} entityId={experience.id} render={(open) => <IconAction label="Share" onClick={open}><ShareIcon size={18} /></IconAction>} />
                  <InviteSheetButton entityType={experience.kind === "adventure" ? "adventure" : "experience"} entityId={experience.id} title={experience.title} render={(open) => <IconAction label="Invite someone" short="Invite" onClick={open}><UsersIcon size={18} /></IconAction>} />
                  {experience.lat !== null && experience.lng !== null && (
                    <IconAction label="Directions" href={directionsUrl}><PinIcon size={18} /></IconAction>
                  )}
                  {/* Circles 3.0 — suggest it in a Circle (secondary to Book). */}
                  <PlanWithCircle
                    listing={{ type: "experience", id: experience.id, title: experience.title, sessions: experience.sessions.filter((s) => s.spotsLeft > 0).slice(0, 12).map((s) => ({ id: s.id, label: `${dateLabel(s.date)} · ${s.time}` })) }}
                    render={(open) => <IconAction label="Plan with my Circle" short="Circle" onClick={open}><UsersRound size={18} /></IconAction>}
                  />
                </BookingActions>
              </div>
              {experience.sessions.length === 0 && (
                <QuietAction onClick={() => navigate(similarPath)}>See similar {experience.kind === "adventure" ? "adventures" : isVolunteer ? "opportunities" : "experiences"}</QuietAction>
              )}
            </Card>
            <div style={{ marginTop: 24 }} />
            {experience.vendorName && (
              <DetailSection title="Hosted by">
                <HostRow
                  name={experience.vendorName}
                  verifiedLabel={experience.vendorVerified ? "Business details checked" : null}
                  href={`/provider/${experience.vendorId}`}
                  linkLabel="View provider"
                />
              </DetailSection>
            )}
            {experience.lat !== null && experience.lng !== null && (
              <DetailSection title="Meeting point">
                <LocationBlock
                  name={experience.meetingPoint || experience.title}
                  area={`${experience.area}${experience.area && experience.county ? ", " : ""}${experience.county}`}
                  directionsUrl={directionsUrl}
                  map={{ lat: experience.lat, lng: experience.lng, label: experience.title }}
                />
              </DetailSection>
            )}
          </div>
        </div>
      </section>


      <Modal
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        title={registerLabel}
        subtitle={bookingSubtitle}
        footer={bookingFooter}
        confirmClose={bookingDirty ? { title: "Discard this booking?", message: "The details you've entered won't be saved." } : undefined}
      >
        {bookingBody}
      </Modal>

      {/* "Can't make this one?" — the shared CtaBand, with this
          listing's own copy and the interest form. */}
      <CtaBand
        id="experience-cta-title"
        label="Not this time?"
        lines={["Can't", "make this", "one?"]}
        text={`No worries — we'll let you know about similar ${experience.kind === "adventure" ? "adventures" : experience.kind === "volunteer" ? "volunteering" : "experiences"} and new dates near you.`}
        panel={{ title: "Another time works better?", text: `Tell us when suits you. We'll let you know when a similar ${experience.kind === "adventure" ? "adventure" : experience.kind === "volunteer" ? "opportunity" : "experience"} is planned.` }}
        action={{
          label: `Explore similar ${experience.kind === "adventure" ? "adventures" : experience.kind === "volunteer" ? "opportunities" : "experiences"}`,
          to: experience.taxonomy ? `${browsePath}?category=${experience.taxonomy.categorySlug}${experience.taxonomy.subcategorySlug ? `&sub=${experience.taxonomy.subcategorySlug}` : ""}` : browsePath,
        }}
      >
        <IntentCaptureForm variant="panel" activityLabel={experience.title} county={experience.county ?? ""} />
      </CtaBand>

      {/* Mobile sticky bar — same fixed-above-tab-bar pattern as
          GameJoinCard's own MobileJoinBar. Unlike a Game there's no
          single-tap join (booking needs a session + a short form), so this
          opens the same booking popup the desktop CTA does. */}
      <div className="mobile-join-bar">
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display, color: joinHeadlineColor }}>{joinHeadline}</div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight }}>
            {anyAvailable && session ? `${dateLabel(session.date)} · ${formatPrice(experience.priceCents)}` : "We can let you know"}
          </div>
        </div>
        {anyAvailable ? (
          <Button onClick={openBooking} style={{ flex: "none" }}>{registerLabel}</Button>
        ) : (
          <Button onClick={() => scrollToInterest("experience-cta-title")} style={{ flex: "none" }}>Notify me</Button>
        )}
      </div>
    </div>
  );
}

/** Stage 5f — a coupon rejection, in the customer's words (reason code from the server). */
function couponMessage(code: string, fallback: string): string {
  switch (code) {
    case "coupon_expired":
      return "That code has expired.";
    case "coupon_limit":
      return "That code has already been used as many times as allowed.";
    case "coupon_not_applicable":
      return "That code can't be used for this activity.";
    case "coupon_not_yet_active":
      return "That code isn't active yet.";
    case "coupon_min_spend":
      return fallback;
    case "coupon_invalid":
      return "That code isn't valid.";
    default:
      return fallback;
  }
}
