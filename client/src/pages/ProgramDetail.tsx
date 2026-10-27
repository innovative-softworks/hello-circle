import { Euro } from "lucide-react";
import { Pass, passDate, passTime } from "../components/pass/Pass";
import { PlanWithCircle } from "../components/circle/PlanWithCircle";
import { ExploreWithOthers } from "../components/circle/ExploreWithOthers";
import { UsersRound } from "lucide-react";
import { BookingActions, BookingFacts, BookingGlance, BookingPrice, directionsHref, IconAction, QuietAction, startsIn, type GlanceItem } from "../components/BookingFacts";
import { CategoryBreadcrumb } from "../components/categories/CategoryChips";
import { UnavailableListing, isUnavailable, type Unavailable } from "../components/UnavailableListing";
import { usePageTitle } from "../pageTitle";
import { PAID_CLOSED_MESSAGE, usePaidCheckoutOpen } from "../paidCheckout";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, enrollInProgram, isNotFound, fetchHousehold, fetchProgram, fetchProgramBrowse, quoteProgram, type PriceQuote } from "../api";
import { BookingSurface, CheckoutSummary, CouponField, CouponRejectedError, couponErrorCopy, couponReasonFromCode } from "../components/booking";
import { openCheckout } from "../native";
import { ListingChatButton } from "../components/ListingChats";
import { BrowseCard } from "../components/BrowseLayout";
import { AwardIcon, CalendarIcon, CheckIcon, ClockIcon, GraduationCapIcon, ShieldIcon, GridIcon, PersonIcon, PinIcon, ShareIcon, UsersIcon } from "../components/icons";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { InviteSheetButton } from "../components/InviteSheetButton";
import { ShareButton } from "../components/ShareButton";
import { OfficialCircleLink } from "../components/OfficialCircleLink";
import { ParticipationBlock } from "../components/ParticipationBlock";
import { Photo } from "../components/Photo";
import { PhotoGallery } from "../components/PhotoGallery";
import { Reviews } from "../components/Reviews";
import { Button, Card, Modal, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
import { dateLabel } from "../euro";
import { formatPrice } from "../formatters";
import { programToBrowseItem } from "./Programs";
import { cardImageRatio, colors, fonts, maxWidth, photoOverlay, radius } from "../theme";
import { isValidEmail } from "../validate";
import type { HouseholdMember, Program, ProgramSession, ProgramSummary } from "../types";
import { irelandToday } from "../irelandDate";
import { CtaBand } from "../components/CtaBand";
import { VENUE_PAGES_PUBLIC } from "../venueLaunch";
import { DetailSection, HostRow, LocationBlock, ScheduleList } from "../components/detail/DetailSections";
import { KeyFacts, PAID_PRICE_NOTE, Requirements } from "../components/detail/KeyFacts";
import { FieldError, FormErrorSummary, useFormErrors, type FormError } from "../components/form";
import { DetailTopBar, detailActionStyle } from "../components/detail/DetailTopBar";
import { DetailUnavailable } from "../components/detail/DetailUnavailable";
import { scrollToInterest } from "../components/detail/scrollToInterest";

// Resident-facing Program detail — the "8-week course, one sign-up"
// counterpart to Experience detail, laid out the same way (ExperienceDetail
// .tsx) so every detail page reads alike: share bar, badge-overlaid hero,
// eyebrow/title/price, quick facts, what to expect, details grid, what to
// bring, the full schedule, hosted by, where, reviews, more like this; a
// sticky enrol card on the right; a "Can't make this one?" band; and a
// mobile join bar. One enrolment covers every session in the schedule, so
// the enrol form (in a popup, like the experience booking form) has no
// session picker.

const sectionDividerStyle: React.CSSProperties = { height: 1, background: colors.border, margin: "28px 0" };

const factLabelStyle: React.CSSProperties = { fontSize: 11.5, color: colors.mutedLight, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0 };

function SectionHeading({ title }: { title: string }) {
  return <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 14px" }}>{title}</h2>;
}

function InfoBlock({ heading, body }: { heading: string; body: string | null | undefined }) {
  if (!body) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14.5, margin: "0 0 6px" }}>{heading}</h3>
      <p style={{ margin: 0, fontSize: 14, color: colors.muted, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{body}</p>
    </div>
  );
}


function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function ProgramDetail() {
  const paidOpen = usePaidCheckoutOpen();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [program, setProgram] = useState<Program | null>(null);
  // D-01: a programme whose organisation is suspended.
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null);
  usePageTitle(program?.title);
  const [loading, setLoading] = useState(true);
  const [similar, setSimilar] = useState<ProgramSummary[]>([]);
  const [form, setForm] = useState({ participantName: "", participantDob: "", email: resident?.email ?? "", phone: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // DP-41 — the site's form-error pattern (per-field messages + linked summary).
  const fe = useFormErrors();
  // Booking UX Phase 4 (UX plan S4) — reuse household members, and record the
  // booking terms acknowledgement with the enrolment.
  const [household, setHousehold] = useState<HouseholdMember[]>([]);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  useEffect(() => {
    if (resident) fetchHousehold().then(setHousehold).catch(() => {});
  }, [resident]);
  const [confirmed, setConfirmed] = useState<{ ref: string } | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  // HC-QA-047 — the enrolment confirmation shows the server's own total.
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  // R3A — an optional code, validated by the server on the quote and again at enrolment.
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [couponProblem, setCouponProblem] = useState<string | null>(null);
  const loadQuote = (code: string | null) => {
    if (!id) return Promise.resolve();
    setQuoteFailed(false);
    return quoteProgram(id, code).then(setQuote);
  };
  useEffect(() => {
    if (!enrollOpen || !id) return;
    let live = true;
    quoteProgram(id, couponCode)
      .then((q) => live && setQuote(q))
      .catch(() => {
        if (!live) return;
        setQuote(null);
        setQuoteFailed(true);
      });
    return () => {
      live = false;
    };
    // The code is re-quoted by CouponField's onApply; this only covers opening.
  }, [enrollOpen, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyCoupon = async (code: string) => {
    try {
      await loadQuote(code);
      setCouponCode(code);
      setCouponProblem(null);
    } catch (e) {
      const reason = e instanceof ApiError ? couponReasonFromCode(e.body.code) : null;
      if (reason) throw new CouponRejectedError(reason);
      throw new Error("We couldn't check that code. Try again.");
    }
  };
  const removeCoupon = () => {
    setCouponCode(null);
    setCouponProblem(null);
    loadQuote(null).catch(() => {
      setQuote(null);
      setQuoteFailed(true);
    });
  };
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [showPast, setShowPast] = useState(false);

  // PUB-14: a failed load (network/5xx) is retryable; only a 404 means the
  // programme isn't available.
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setLoadError(false);
    fetchProgram(id)
      .then((p) => {
        if (isUnavailable(p)) return setUnavailable(p);
        setProgram(p);
        // "More like this" — other programs with upcoming dates, same
        // category (or same county when uncategorised), this one excluded.
        fetchProgramBrowse(p.category ? undefined : p.venueCounty, p.category || undefined)
          .then((rows) => setSimilar(rows.filter((r) => r.id !== p.id).slice(0, 8)))
          .catch(() => setSimilar([]));
      })
      .catch((e) => {
        setProgram(null);
        if (!isNotFound(e)) setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [id, reloadKey]);

  useEffect(() => {
    if (resident?.email) setForm((f) => ({ ...f, email: resident.email }));
  }, [resident]);

  const today = irelandToday();
  const upcoming = useMemo<ProgramSession[]>(() => (program?.sessions ?? []).filter((s) => s.date >= today), [program, today]);
  const past = useMemo<ProgramSession[]>(() => (program?.sessions ?? []).filter((s) => s.date < today), [program, today]);

  const submit = async () => {
    if (!id) return;
    const problems: FormError[] = [];
    if (!form.participantName.trim()) problems.push({ field: "name", fieldId: "prog-participant", message: "Enter the participant's name" });
    if (!isValidEmail(form.email)) problems.push({ field: "email", fieldId: "prog-email", message: "Enter an email address like name@example.ie" });
    if (!acceptedTerms) problems.push({ field: "terms", fieldId: "prog-terms", message: "Tick the box to agree to the booking terms" });
    if (problems.length) {
      setError(null);
      fe.fail(problems);
      return;
    }
    fe.clear();
    setError(null);
    setSubmitting(true);
    try {
      const res = await enrollInProgram(id, { ...form, acceptedTerms, couponCode: couponCode ?? undefined });
      if (res.url) {
        openCheckout(res.url);
        return;
      }
      setEnrollOpen(false);
      setConfirmed({ ref: res.ref });
    } catch (e) {
      // R3A — the code stopped applying between the quote and enrolment (e.g. it
      // expired): say so next to the code and re-price without it.
      const reason = e instanceof ApiError ? couponReasonFromCode(e.body.code) : null;
      if (reason && couponCode) {
        setCouponProblem(couponErrorCopy(reason));
        loadQuote(null).catch(() => setQuoteFailed(true));
        setError("Your total changed because the code no longer applies. Check it, then continue.");
      } else {
        setError(e instanceof Error ? e.message : "Couldn't complete enrollment");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSpinner />;
  if (unavailable) return <UnavailableListing item={unavailable} />;
  if (loadError) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px, 2.4vw, 30px)", margin: "0 0 10px" }}>We couldn't load this programme.</h1>
        <p style={{ color: colors.mutedLight, margin: "0 0 16px" }}>Check your connection and try again.</p>
        <Button onClick={() => setReloadKey((k) => k + 1)}>Try again</Button>
      </section>
    );
  }
  if (!program) return <DetailUnavailable noun="programme" listPath="/programs" listLabel="Browse programmes" />;

  if (confirmed) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "56px 24px 64px", display: "grid", gap: 20 }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "clamp(32px, 3.8vw, 52px)", margin: 0, textAlign: "center" }}>You're enrolled.</h1>
        {/* The pass, ticket look (owner 2026-10-27), with the run of sessions. */}
        <Pass
          look="ticket"
          kind="programme"
          tone="ok"
          status="Enrolled"
          title={program.title}
          who={form.participantName.trim() || null}
          date={upcoming[0] ? `Starts ${passDate(upcoming[0].date)}` : null}
          time={upcoming[0] ? passTime(upcoming[0].time, upcoming[0].durationMinutes) : null}
          where={[program.listingName, program.venueArea].filter(Boolean).join(", ")}
          progress={{ done: 0, total: program.sessions.length }}
          fields={[
            ["Sessions", String(program.sessions.length)],
            ["Paid", program.priceCents ? formatPrice(program.priceCents) : "Free"],
          ]}
          reference={confirmed.ref}
        >
          <BookingActions>
            <InviteSheetButton entityType="program" entityId={program.id} title={program.title} render={(open) => <IconAction label="Invite someone" short="Invite" onClick={open}><UsersIcon size={18} /></IconAction>} />
            <ShareButton entityType="program" entityId={program.id} render={(open) => <IconAction label="Share" onClick={open}><ShareIcon size={18} /></IconAction>} />
            <IconAction label="Directions" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${program.listingName}, ${program.venueArea ?? ""}, ${program.venueCounty ?? ""}`)}`}><PinIcon size={18} /></IconAction>
          </BookingActions>
        </Pass>
        <Button full onClick={() => navigate("/bookings")}>View my bookings</Button>
      </section>
    );
  }

  const next = upcoming[0] ?? null;
  const last = upcoming[upcoming.length - 1] ?? null;
  const full = program.capacity !== null && program.spotsLeft === 0;
  const canEnroll = !full && upcoming.length > 0;
  const tone = program.listingType === "club" ? "orange" : "green";
  const accent = tone === "green" ? colors.green : colors.orange;
  const venueHref = `/${program.listingType === "centre" ? "centres" : "clubs"}/${program.venueSlug ?? program.listingId}`;
  const venueLine = [program.listingName, program.venueArea].filter(Boolean).join(", ");
  const typicalDuration = upcoming[0]?.durationMinutes ?? program.sessions[0]?.durationMinutes ?? null;
  const description = program.description || "";
  const descriptionIsLong = description.length > 320;
  const visibleDescription = descriptionExpanded || !descriptionIsLong ? description : `${description.slice(0, 320).trimEnd()}…`;
  const similarPath = program.taxonomy ? `/programs?category=${program.taxonomy.categorySlug}${program.taxonomy.subcategorySlug ? `&sub=${program.taxonomy.subcategorySlug}` : ""}` : "/programs";
  // At a glance (owner 2026-10-27): only what the venue filled in. "One
  // sign-up, every session" moved in here from its own grey card.
  const glance: GlanceItem[] = [];
  if (program.sessions.length > 1) glance.push({ key: "sessions", icon: <CalendarIcon size={16} />, value: `${program.sessions.length} sessions`, sub: "one sign-up books them all" });
  if (typicalDuration || program.skillLevel)
    glance.push({
      key: "length",
      icon: typicalDuration ? <ClockIcon size={16} /> : <AwardIcon size={16} />,
      value: typicalDuration ? `${formatDuration(typicalDuration)} each` : program.skillLevel,
      sub: typicalDuration ? program.skillLevel || undefined : undefined,
    });
  if (program.ageRange) glance.push({ key: "age", icon: <PersonIcon size={16} />, value: `Ages ${program.ageRange}` });
  if (program.equipment.length) glance.push({ key: "bring", icon: <ShieldIcon size={16} />, value: "Bring", sub: program.equipment.join(", ") });
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${program.listingName}, ${program.venueArea ?? ""}, ${program.venueCounty ?? ""}`)}`;

  const joinHeadline = !upcoming.length ? "No dates yet" : full ? "Full" : program.spotsLeft === null ? "Spaces available" : program.spotsLeft === 1 ? "1 spot left" : `${program.spotsLeft} spots left`;
  const joinHeadlineColor = !upcoming.length || full ? colors.muted : program.spotsLeft !== null && program.spotsLeft <= 3 ? colors.orangeDark : colors.text;


  // Enrol popup — context in the header, the form in the body, and the
  // price + button pinned in the footer so they never scroll away.
  const enrollDirty = form.participantName.trim() !== "" || form.phone.trim() !== "" || form.participantDob !== "";
  const enrollSubtitle = [next ? `Starts ${dateLabel(next.date)} · ${next.time}` : null, `${upcoming.length} session${upcoming.length === 1 ? "" : "s"}`, program.listingName]
    .filter(Boolean)
    .join(" · ");
  // Commercial release gate — card payment can't start while paid checkout is closed (the server refuses it too).
  const programPaidClosed = paidOpen === false && !!program.priceCents && (quote ? quote.totalCents > 0 : true);
  const enrollFooter = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: program.priceCents ? colors.text : colors.greenText }}>
          {program.priceCents ? (quote ? `€${(quote.totalCents / 100).toFixed(2)}` : "…") : "Free"}
        </div>
        <div style={{ fontSize: 12, color: colors.mutedLight }}>
          {program.priceCents ? (quote ? "Whole programme, incl. VAT and fee" : quoteFailed ? "Price unavailable — try again" : "Calculating total…") : "No payment required"}
        </div>
      </div>
      <Button onClick={submit} disabled={submitting || programPaidClosed} style={{ flex: "none" }}>
        {submitting ? "Please wait…" : program.priceCents ? "Continue to pay" : "Enrol"}
      </Button>
    </div>
  );

  const enrollForm = (
    <>
      {programPaidClosed && (
        <p role="status" style={{ fontSize: 13.5, fontWeight: 600, color: colors.orangeDark, background: colors.orangeBg, borderRadius: radius.control, padding: "10px 12px", margin: "0 0 14px" }}>
          {PAID_CLOSED_MESSAGE}
        </p>
      )}
      <FormErrorSummary errors={fe.errors} focusKey={fe.focusKey} />
      <div style={{ fontSize: 13.5, color: colors.muted, marginBottom: 16, background: colors.panel, borderRadius: radius.control, padding: "10px 12px" }}>
        One enrolment covers every session — you don't book them one by one.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {household.length > 0 && (
          <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
            <legend style={{ ...labelStyle, padding: 0 }}>From your household</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {household.map((m) => {
                const name = `${m.firstName} ${m.lastName}`.trim();
                const picked = form.participantName === name;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={picked}
                    onClick={() => setForm((f) => ({ ...f, participantName: name, participantDob: m.dob || f.participantDob }))}
                    style={{ minHeight: 40, padding: "0 14px", borderRadius: radius.pill, border: `1px solid ${picked ? colors.text : colors.borderStrong}`, background: picked ? colors.text : colors.surface, color: picked ? colors.surface : colors.text, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <div>
          <label htmlFor="prog-participant" style={labelStyle}>Participant name</label>
          <input {...fe.control("prog-participant")} autoComplete="name" value={form.participantName} onChange={(e) => { setForm((f) => ({ ...f, participantName: e.target.value })); fe.clearField("prog-participant"); }} style={inputStyle} />
          <FieldError fieldId="prog-participant" message={fe.messageFor("prog-participant")} />
        </div>
        <div>
          <label htmlFor="prog-dob" style={labelStyle}>Participant date of birth (optional)</label>
          <input id="prog-dob" type="date" value={form.participantDob} onChange={(e) => setForm((f) => ({ ...f, participantDob: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label htmlFor="prog-email" style={labelStyle}>Email</label>
          <input {...fe.control("prog-email", "prog-email-help")} type="email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={inputStyle} />
          <FieldError fieldId="prog-email" message={fe.messageFor("prog-email")} />
          <div id="prog-email-help" style={{ fontSize: 12, color: colors.faint, marginTop: 4 }}>We'll send your confirmation here.</div>
        </div>
        <div>
          <label htmlFor="prog-phone" style={labelStyle}>Phone (optional)</label>
          <input id="prog-phone" type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} style={inputStyle} />
        </div>
        {!!program.priceCents && (
          <BookingSurface style={{ padding: "14px 16px", borderRadius: radius.control, display: "flex", flexDirection: "column", gap: 12 }}>
            <CouponField
              applied={couponCode}
              appliedProblem={couponProblem}
              onApply={applyCoupon}
              onRemove={removeCoupon}
            />
            <CheckoutSummary
              state={quote ? { status: "ready", quote, error: null, seq: 0 } : quoteFailed ? { status: "error", quote: null, error: "Check your connection and try again.", seq: 0 } : { status: "loading", quote: null, error: null, seq: 0 }}
              subtotalLabel="Whole programme"
              onRetry={() => loadQuote(couponCode).catch(() => setQuoteFailed(true))}
            />
          </BookingSurface>
        )}
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, lineHeight: 1.45, minHeight: 44, cursor: "pointer" }}>
          <input type="checkbox" id="prog-terms" aria-invalid={fe.messageFor("prog-terms") ? true : undefined} aria-describedby={fe.messageFor("prog-terms") ? "prog-terms-error" : undefined} checked={acceptedTerms} onChange={(e) => { setAcceptedTerms(e.target.checked); fe.clearField("prog-terms"); }} style={{ width: 20, height: 20, margin: "1px 0 0", flex: "none" }} />
          <span>
            I agree to the <Link to="/policies/customer-booking-terms" target="_blank">booking terms</Link>
          </span>
        </label>
        <FieldError fieldId="prog-terms" message={fe.messageFor("prog-terms")} />
      </div>
      {error && (
        <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: "12px 0 0" }}>
          {error}
        </p>
      )}
    </>
  );

  return (
    <div className="experience-detail-mobile-pad fade-panel">
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 90px" }}>
        <DetailTopBar
            backTo="/programs"
            backLabel="All programmes"
            extra={<>
              <ListingChatButton scopeType="program" listingId={program.id} style={detailActionStyle} refreshKey={program.enrolled} />
              <InviteSheetButton entityType="program" entityId={program.id} title={program.title} />
            </>}
            share={{ entityType: "program", entityId: program.id }}
            save={{ kind: "program", id: program.id }}
            report={{ type: "program", id: program.id, what: "this programme" }}
          />

        {/* Detail-page redesign: 70/30; on phones the booking column follows the head. */}
        <div className="detail-grid">
          <div className="detail-head">
            {/* HERO — same badge-overlaid Photo treatment as ExperienceDetail:
                next session top-left, spots top-right. */}
            {/* Batch 2 — the shared cover (same frame and slides on every detail page). */}
            <PhotoGallery
              images={[program.imageUrl]}
              alt={program.title}
              ph={tone === "green" ? colors.greenBg : colors.orangeBg}
              icon={<GridIcon size={40} />}
              iconColor={accent}
              style={{ marginBottom: 24 }}
              overlay={<>
              {next ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: photoOverlay.whiteBg, color: colors.text, borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 700 }}>
                  <CalendarIcon size={13} /> Starts {dateLabel(next.date)} · {next.time}
                </span>
              ) : (
                <span />
              )}
              {/* Availability lives in the booking panel; the cover only flags "Full". */}
              {upcoming.length > 0 && full && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 700, background: photoOverlay.whiteBg, color: colors.muted }}>
                  Full
                </span>
              )}
              </>}
            />

            <div style={{ marginBottom: 8 }}>
              <CategoryBreadcrumb taxonomy={program.taxonomy} tags={program.tags} basePath="/programs" typeLabel="Programmes" />
            </div>
            {/* Eyebrow + title + price row — same as ExperienceDetail/GameDetail. */}
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>
              Programme{program.category ? ` · ${program.category}` : ""}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(32px, 3.8vw, 52px)", margin: 0, letterSpacing: 0 }}>{program.title}</h1>

            </div>
            {/* When and where, once, under the title (owner 2026-10-27, booking
                box option 2): the booking box no longer repeats them. */}
            <div className="detail-when-where">
              <span>
                <CalendarIcon size={15} />
                {next ? (
                  <>
                    <b>Starts {dateLabel(next.date)} · {next.time}</b>
                    {upcoming.length > 1 ? <> · {upcoming.length} sessions{last ? ` until ${dateLabel(last.date)}` : ""}</> : null}
                  </>
                ) : (
                  <b>No upcoming sessions yet</b>
                )}
              </span>
              {(program.listingName || venueLine) && <span>
                <PinIcon size={15} />
                <a href={venueHref} onClick={(e) => { e.preventDefault(); navigate(venueHref); }} style={{ fontWeight: 700 }}>
                  {program.listingName || venueLine}
                </a>
                {[program.venueArea, program.venueCounty].filter(Boolean).length ? <>, {[program.venueArea, program.venueCounty].filter(Boolean).join(", ")}</> : null}
                {" · "}
                <a href={directionsHref([program.listingName, program.venueArea, program.venueCounty].filter(Boolean).join(", "), program.venueLat, program.venueLng)} target="_blank" rel="noreferrer">
                  Directions
                </a>
              </span>}
            </div>
            {program.vendorName && <div style={{ color: colors.mutedLight, fontSize: 14, marginTop: 4 }}>Hosted by {program.vendorName}</div>}
            <KeyFacts
              facts={[
                upcoming.length > 0 && { icon: <CalendarIcon size={17} />, value: `${upcoming.length} session${upcoming.length === 1 ? "" : "s"}`, label: last && last !== next ? `Until ${dateLabel(last.date)}` : "Sessions to go" },
                !!typicalDuration && { icon: <ClockIcon size={17} />, value: formatDuration(typicalDuration), label: "Per session" },
                !!program.ageRange && { icon: <PersonIcon size={17} />, value: program.ageRange, label: "Ages" },
                !!program.skillLevel && { icon: <AwardIcon size={17} />, value: program.skillLevel, label: "Level" },
                program.capacity !== null && { icon: <UsersIcon size={17} />, value: `Up to ${program.capacity}`, label: "Group size" },
                !!program.instructorName && { icon: <GraduationCapIcon size={17} />, value: program.instructorName, label: "Instructor" },
              ]}
            />

            <ParticipationBlock attributes={program.participationAttributes} going={program.enrolled || undefined} />
            <OfficialCircleLink circleId={program.circleId} circleName={program.circleName} circleSlug={program.circleSlug} />

            {program.arrivalInstructions && (
              <div style={{ background: colors.greenBg, color: colors.greenText, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5, margin: "16px 0" }}>
                <strong>Arriving:</strong> {program.arrivalInstructions}
              </div>
            )}
            {!upcoming.length && (
              <div style={{ background: colors.panel, color: colors.muted, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5, margin: "16px 0" }}>
                No upcoming sessions scheduled — check back soon, or tell us you're interested below.
              </div>
            )}

          </div>

          <div className="detail-body">
            <div style={sectionDividerStyle} />

            {description && (
              <div style={{ marginBottom: 28 }}>
                <SectionHeading title="About this programme" />
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

            {program.equipment.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionHeading title="What to bring" />
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {program.equipment.map((item) => (
                    <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 14, color: colors.textSoft }}>
                      <CheckIcon size={14} style={{ color: colors.greenText, flex: "none", marginTop: 3 }} /> {item}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Requirements rows={[{ label: "Accessibility", value: program.accessibilityInfo }]} />
            <InfoBlock heading="Guardian rules" body={program.guardianRules} />
            <InfoBlock heading="Safeguarding" body={program.safeguardingInfo} />

            {/* Schedule — upcoming first; past sessions behind a toggle. */}
            <DetailSection title="Schedule">
              {upcoming.length > 0 ? (
                <ScheduleList
                  rows={upcoming.map((s) => ({
                    id: s.id,
                    date: dateLabel(s.date),
                    time: `${s.time} · ${formatDuration(s.durationMinutes)}`,
                    extra: [s.roomName, s.instructorName].filter(Boolean).join(" · ") || null,
                  }))}
                />
              ) : (
                <p style={{ color: colors.mutedLight, fontSize: 14, margin: 0 }}>No upcoming sessions scheduled yet.</p>
              )}
              {past.length > 0 && (
                <button className="tap-target" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast} style={{ background: "none", border: "none", padding: 0, marginTop: 8, fontSize: 13.5, fontWeight: 700, color: colors.muted, cursor: "pointer", textDecoration: "underline" }}>
                  {showPast ? "Hide past sessions" : `Show ${past.length} past session${past.length === 1 ? "" : "s"}`}
                </button>
              )}
              {showPast && (
                <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  {past.map((s) => (
                    <li key={s.id} style={{ fontSize: 13.5, color: colors.faint }}>{dateLabel(s.date)} · {s.time}</li>
                  ))}
                </ul>
              )}
            </DetailSection>

            <div style={{ marginBottom: 28 }}>
              <Reviews listingType="program" listingId={program.id} accent={tone} />
            </div>

            <ExploreWithOthers taxonomy={program.taxonomy} county={program.venueCounty} noun="programme" excludeCircleId={program.circleId} />
            {similar.length > 0 && (
              <div>
                <SectionHeading title="More like this" />
                {/* The shared photo card (owner 2026-10-27), same as every "More like this". */}
                <div className="lc-grid--b" style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 6 }}>
                  {similar.map((p) => (
                    <div key={p.id} style={{ flex: "none", width: 260, display: "flex" }}>
                      <BrowseCard e={programToBrowseItem(p)} icon={<GridIcon size={24} />} kindLabel="Programme" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN — sticky enrol card, same rhythm as ExperienceDetail's. */}
          <div className="detail-aside">
            <Card>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: 0, color: joinHeadlineColor }}>{joinHeadline}</h2>
                {next ? (
                  <p style={{ margin: "4px 0 0", fontSize: 13.5, color: colors.mutedLight }}>
                    {[startsIn(next.date, next.time), program.enrolled > 0 && program.capacity !== null ? `${program.enrolled} of ${program.capacity} enrolled` : null].filter(Boolean).join(" · ")}
                  </p>
                ) : (
                  <p style={{ margin: "4px 0 0", fontSize: 13.5, color: colors.mutedLight }}>The venue hasn't set the next start date. We can tell you when they do.</p>
                )}
              </div>

              <div style={{ height: 1, background: colors.border, margin: "0 0 16px" }} />

              <BookingGlance items={glance} />
              <BookingFacts
                // Date and place live under the title (owner 2026-10-27).
                facts={[
                  {
                    key: "price",
                    label: "Price",
                    icon: <Euro size={18} strokeWidth={2} />,
                    value: <BookingPrice cents={program.priceCents} unit={program.sessions.length > 1 ? `for ${program.sessions.length} sessions` : "for the programme"} />,
                    sub: program.priceCents ? PAID_PRICE_NOTE : undefined,
                    emphasis: program.priceCents ? "price" : "free",
                  },
                ]}
              />

              {canEnroll ? (
                <Button full onClick={() => setEnrollOpen(true)}>Enrol</Button>
              ) : upcoming.length === 0 ? (
                // No dates yet: pick the days and times that suit, right here.
                <IntentCaptureForm variant="box" activityLabel={program.category || program.title} county={program.venueCounty ?? ""} />
              ) : (
                <Button full variant="ghost" onClick={() => scrollToInterest("program-cta-title")}>Tell me about new dates</Button>
              )}
              {canEnroll && !program.priceCents && <div style={{ textAlign: "center", fontSize: 12, color: colors.faint, marginTop: 8 }}>No payment required</div>}
              <div style={{ marginTop: 10 }}>
                <BookingActions>
                  <ShareButton entityType="program" entityId={program.id} render={(open) => <IconAction label="Share" onClick={open}><ShareIcon size={18} /></IconAction>} />
                  <InviteSheetButton entityType="program" entityId={program.id} title={program.title} render={(open) => <IconAction label="Invite someone" short="Invite" onClick={open}><UsersIcon size={18} /></IconAction>} />
                  <IconAction label="Directions" href={directionsUrl}><PinIcon size={18} /></IconAction>
                  {/* Circles 3.0 — suggest it in a Circle; enrolment stays programme-level. */}
                  <PlanWithCircle
                    listing={{ type: "program", id: program.id, title: program.title, sessions: upcoming.slice(0, 12).map((s) => ({ id: s.id, label: `${dateLabel(s.date)} · ${s.time}` })) }}
                    render={(open) => <IconAction label="Plan with my Circle" short="Circle" onClick={open}><UsersRound size={18} /></IconAction>}
                  />
                </BookingActions>
              </div>
              {upcoming.length === 0 && <QuietAction onClick={() => navigate(similarPath)}>See similar programmes</QuietAction>}
            </Card>
            <div style={{ marginTop: 24 }} />
            {program.vendorName && (
              <DetailSection title="Hosted by">
                <HostRow
                  name={program.vendorName}
                  verifiedLabel={program.vendorVerified ? "Verified provider" : null}
                  href={program.vendorId ? `/provider/${program.vendorId}` : null}
                  linkLabel="View provider"
                />
              </DetailSection>
            )}

            <DetailSection title="Where">
              <LocationBlock
                name={program.listingName}
                nameHref={VENUE_PAGES_PUBLIC ? venueHref : null}
                area={[program.venueArea, program.venueCounty].filter(Boolean).join(", ") || null}
                directionsUrl={directionsUrl}
                map={program.venueLat != null && program.venueLng != null ? { lat: program.venueLat, lng: program.venueLng, label: program.listingName } : null}
              />
            </DetailSection>

          </div>
        </div>
      </section>

      <Modal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        title={`Enrol in ${program.title}`}
        subtitle={enrollSubtitle}
        footer={enrollFooter}
        confirmClose={enrollDirty ? { title: "Discard this enrolment?", message: "The details you've entered won't be saved." } : undefined}
      >
        {enrollForm}
      </Modal>

      {/* "Can't make this one?" — the shared CtaBand, with this
          programme's own copy and the interest form. */}
      <CtaBand
        id="program-cta-title"
        label="Not this time?"
        lines={["Can't", "make this", "one?"]}
        text="No worries — we'll let you know about similar programmes and new start dates near you."
        panel={{ title: "Another time works better?", text: "Tell us when suits you. We'll let you know when a similar programme starts." }}
        action={{
          label: "Explore similar programmes",
          to: program.taxonomy ? `/programs?category=${program.taxonomy.categorySlug}${program.taxonomy.subcategorySlug ? `&sub=${program.taxonomy.subcategorySlug}` : ""}` : "/programs",
        }}
      >
        <IntentCaptureForm variant="panel" activityLabel={program.category || program.title} county={program.venueCounty ?? ""} />
      </CtaBand>

      {/* Mobile sticky bar — opens the same enrol popup as the desktop CTA. */}
      <div className="mobile-join-bar">
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display, color: joinHeadlineColor }}>{joinHeadline}</div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight }}>
            {canEnroll && next ? `Starts ${dateLabel(next.date)} · ${formatPrice(program.priceCents)}` : "We can let you know"}
          </div>
        </div>
        {canEnroll ? (
          <Button onClick={() => setEnrollOpen(true)} style={{ flex: "none" }}>Enrol</Button>
        ) : (
          <Button onClick={() => scrollToInterest("program-cta-title")} style={{ flex: "none" }}>Notify me</Button>
        )}
      </div>
    </div>
  );
}
