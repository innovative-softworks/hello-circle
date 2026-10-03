import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { enrollInProgram, fetchProgram, fetchProgramBrowse, quoteProgram, type PriceQuote } from "../api";
import { openCheckout } from "../native";
import { ListingChatButton } from "../components/ListingChats";
import { BackLink } from "../components/BackLink";
import { BrowseCard } from "../components/BrowseLayout";
import { AwardIcon, CalendarIcon, CheckIcon, ClockIcon, GridIcon, PinIcon, UsersIcon } from "../components/icons";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { InviteSheetButton } from "../components/InviteSheetButton";
import { OfficialCircleLink } from "../components/OfficialCircleLink";
import { ParticipationBlock } from "../components/ParticipationBlock";
import { Photo } from "../components/Photo";
import { Reviews } from "../components/Reviews";
import { ShareButton } from "../components/ShareButton";
import { SinglePinMap } from "../components/SinglePinMap";
import { Button, Card, Modal, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
import { dateLabel } from "../euro";
import { formatPrice } from "../formatters";
import { programToBrowseItem } from "./Programs";
import { cardImageRatio, colors, fonts, maxWidth, photoOverlay, radius } from "../theme";
import { isValidEmail } from "../validate";
import type { Program, ProgramSession, ProgramSummary } from "../types";

// Resident-facing Program detail — the "8-week course, one sign-up"
// counterpart to Experience detail, laid out the same way (ExperienceDetail
// .tsx) so every detail page reads alike: share bar, badge-overlaid hero,
// eyebrow/title/price, quick facts, what to expect, details grid, what to
// bring, the full schedule, hosted by, where, reviews, more like this; a
// sticky enrol card on the right; a "Can't make this one?" band; and a
// mobile join bar. One enrolment covers every session in the schedule, so
// the enrol form (in a popup, like the experience booking form) has no
// session picker.

const outlineButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: colors.surface,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.control,
  padding: "9px 16px",
  fontSize: 13.5,
  fontWeight: 600,
  color: colors.text,
  cursor: "pointer",
};
const factLabelStyle: React.CSSProperties = { fontSize: 11.5, color: colors.mutedLight, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" };
const sectionDividerStyle: React.CSSProperties = { height: 1, background: colors.border, margin: "28px 0" };

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

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function ProgramDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [similar, setSimilar] = useState<ProgramSummary[]>([]);
  const [form, setForm] = useState({ participantName: "", participantDob: "", email: resident?.email ?? "", phone: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ ref: string } | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  // HC-QA-047 — the enrolment confirmation shows the server's own total.
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  useEffect(() => {
    if (!enrollOpen || !id) return;
    let live = true;
    quoteProgram(id).then((q) => live && setQuote(q)).catch(() => live && setQuote(null));
    return () => {
      live = false;
    };
  }, [enrollOpen, id]);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchProgram(id)
      .then((p) => {
        setProgram(p);
        // "More like this" — other programs with upcoming dates, same
        // category (or same county when uncategorised), this one excluded.
        fetchProgramBrowse(p.category ? undefined : p.venueCounty, p.category || undefined)
          .then((rows) => setSimilar(rows.filter((r) => r.id !== p.id).slice(0, 8)))
          .catch(() => setSimilar([]));
      })
      .catch(() => setProgram(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (resident?.email) setForm((f) => ({ ...f, email: resident.email }));
  }, [resident]);

  const today = todayIso();
  const upcoming = useMemo<ProgramSession[]>(() => (program?.sessions ?? []).filter((s) => s.date >= today), [program, today]);
  const past = useMemo<ProgramSession[]>(() => (program?.sessions ?? []).filter((s) => s.date < today), [program, today]);

  const submit = async () => {
    if (!id || !form.participantName || !isValidEmail(form.email)) {
      setError("A participant name and a valid email are required");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await enrollInProgram(id, form);
      if (res.url) {
        openCheckout(res.url);
        return;
      }
      setEnrollOpen(false);
      setConfirmed({ ref: res.ref });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't complete enrollment");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSpinner />;
  if (!program) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 10px" }}>This program isn't available.</h1>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>It may have finished or been taken down by the venue.</p>
        <Button onClick={() => navigate("/programs")}>Browse programs</Button>
      </section>
    );
  }

  if (confirmed) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 10px" }}>You're enrolled.</h1>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>
          {program.title} · Reference {confirmed.ref}
        </p>
        <Button onClick={() => navigate("/bookings")}>View my bookings</Button>
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
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${program.listingName}, ${program.venueArea ?? ""}, ${program.venueCounty ?? ""}`)}`;

  const joinHeadline = !upcoming.length ? "No dates yet" : full ? "Full" : program.spotsLeft === null ? "Spaces available" : program.spotsLeft === 1 ? "1 spot left" : `${program.spotsLeft} spots left`;
  const joinHeadlineColor = !upcoming.length || full ? colors.muted : program.spotsLeft !== null && program.spotsLeft <= 3 ? colors.orangeDark : colors.text;

  const quickFacts = [
    upcoming.length ? `${upcoming.length} session${upcoming.length === 1 ? "" : "s"}` : null,
    typicalDuration ? `${formatDuration(typicalDuration)} each` : null,
    program.ageRange ? `Ages ${program.ageRange}` : null,
    program.skillLevel || null,
  ].filter((v): v is string => !!v);

  const detailFields: { label: string; value: string }[] = [
    { label: "Starts", value: next ? `${dateLabel(next.date)} · ${next.time}` : "No upcoming dates" },
    ...(last && last !== next ? [{ label: "Last session", value: dateLabel(last.date) }] : []),
    { label: "Where", value: venueLine || program.listingName },
    ...(program.ageRange ? [{ label: "Ages", value: program.ageRange }] : []),
    ...(program.skillLevel ? [{ label: "Level", value: program.skillLevel }] : []),
    ...(program.category ? [{ label: "Category", value: program.category }] : []),
    ...(program.instructorName ? [{ label: "Instructor", value: program.instructorName }] : []),
    ...(program.capacity !== null ? [{ label: "Group size", value: `Up to ${program.capacity}` }] : []),
    { label: "Price", value: program.priceCents ? `${formatPrice(program.priceCents)} for the whole program` : "Free" },
  ];

  // Enrol popup — context in the header, the form in the body, and the
  // price + button pinned in the footer so they never scroll away.
  const enrollDirty = form.participantName.trim() !== "" || form.phone.trim() !== "" || form.participantDob !== "";
  const enrollSubtitle = [next ? `Starts ${dateLabel(next.date)} · ${next.time}` : null, `${upcoming.length} session${upcoming.length === 1 ? "" : "s"}`, program.listingName]
    .filter(Boolean)
    .join(" · ");
  const enrollFooter = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: program.priceCents ? colors.text : colors.greenText }}>
          {program.priceCents ? (quote ? `€${(quote.totalCents / 100).toFixed(2)}` : "…") : "Free"}
        </div>
        <div style={{ fontSize: 12, color: colors.mutedLight }}>
          {program.priceCents
            ? quote
              ? `€${(program.priceCents / 100).toFixed(2)} + VAT €${(quote.vatCents / 100).toFixed(2)} + fee €${(quote.platformFeeCents / 100).toFixed(2)} · every session`
              : "Calculating total…"
            : "No payment required"}
        </div>
      </div>
      <Button onClick={submit} disabled={submitting} style={{ flex: "none" }}>
        {submitting ? "Please wait…" : program.priceCents ? "Continue to pay" : "Enroll"}
      </Button>
    </div>
  );

  const enrollForm = (
    <>
      <div style={{ fontSize: 13.5, color: colors.muted, marginBottom: 16, background: colors.panel, borderRadius: radius.control, padding: "10px 12px" }}>
        One enrolment covers every session — you don't book them one by one.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={labelStyle}>Participant name</label>
          <input autoComplete="name" value={form.participantName} onChange={(e) => setForm((f) => ({ ...f, participantName: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Participant date of birth (optional)</label>
          <input type="date" value={form.participantDob} onChange={(e) => setForm((f) => ({ ...f, participantDob: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input type="email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={inputStyle} />
          <div style={{ fontSize: 12, color: colors.faint, marginTop: 4 }}>We'll send your confirmation here.</div>
        </div>
        <div>
          <label style={labelStyle}>Phone (optional)</label>
          <input type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} style={inputStyle} />
        </div>
      </div>
      {error && (
        <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: "12px 0 0" }}>
          {error}
        </p>
      )}
    </>
  );

  return (
    <div className="experience-detail-mobile-pad" style={{ animation: "fadeUp .3s ease backwards" }}>
      <section className="section-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "26px 24px 90px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
          <BackLink onClick={() => navigate("/programs")} marginBottom={0}>All programs</BackLink>
          <div style={{ display: "flex", gap: 10 }}>
            <ListingChatButton scopeType="program" listingId={program.id} style={outlineButtonStyle} refreshKey={program.enrolled} />
            <ShareButton entityType="program" entityId={program.id} render={(onClick) => <button onClick={onClick} style={outlineButtonStyle}>Share</button>} />
            <InviteSheetButton entityType="program" entityId={program.id} title={program.title} />
          </div>
        </div>

        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 32, alignItems: "start" }}>
          {/* LEFT COLUMN */}
          <div>
            {/* HERO — same badge-overlaid Photo treatment as ExperienceDetail:
                next session top-left, spots top-right. */}
            <Photo
              src={program.imageUrl || undefined}
              alt={program.title}
              ph={tone === "green" ? colors.greenBg : colors.orangeBg}
              icon={<GridIcon size={40} />}
              iconColor={accent}
              variant="hero"
              eager
              sharedHero
              style={{ aspectRatio: cardImageRatio.hero, borderRadius: 20, marginBottom: 24 }}
              contentStyle={{ padding: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}
            >
              {next ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: photoOverlay.whiteBg, color: colors.text, borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 700 }}>
                  <CalendarIcon size={13} /> Starts {dateLabel(next.date)} · {next.time}
                </span>
              ) : (
                <span />
              )}
              {upcoming.length > 0 && program.spotsLeft !== null && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    borderRadius: radius.pill,
                    padding: "6px 12px",
                    fontSize: 13,
                    fontWeight: 700,
                    background: full ? photoOverlay.whiteBg : photoOverlay.goldBg,
                    color: full ? colors.muted : photoOverlay.goldText,
                  }}
                >
                  {full ? "Full" : `${program.spotsLeft} spot${program.spotsLeft === 1 ? "" : "s"} left`}
                </span>
              )}
            </Photo>

            {/* Eyebrow + title + price row — same as ExperienceDetail/GameDetail. */}
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>
              Program{program.category ? ` · ${program.category}` : ""}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 28, margin: 0, letterSpacing: "-.01em" }}>{program.title}</h1>
              <div style={{ flex: "none", textAlign: "right" }}>
                {program.priceCents ? (
                  <>
                    <div style={{ fontWeight: 800, fontSize: 22, color: colors.text }}>€{(program.priceCents / 100).toFixed(2)}</div>
                    <div style={{ fontSize: 12, color: colors.mutedLight }}>whole program</div>
                  </>
                ) : (
                  <div style={{ fontWeight: 700, fontSize: 14, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "4px 12px" }}>Free</div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, color: colors.mutedLight, fontSize: 13.5, marginTop: 8 }}>
              <PinIcon size={13} />
              <button onClick={() => navigate(venueHref)} style={{ background: "none", border: "none", padding: 0, color: colors.mutedLight, fontSize: 13.5, cursor: "pointer", textDecoration: "underline" }}>
                {venueLine || program.listingName}
              </button>
            </div>
            {quickFacts.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13.5, color: colors.muted, marginTop: 10 }}>
                {quickFacts.map((item, i) => (
                  <span key={item}>
                    {i > 0 && <span style={{ margin: "0 8px 0 0", color: colors.faint }}>·</span>}
                    {item}
                  </span>
                ))}
              </div>
            )}

            <ParticipationBlock attributes={program.participationAttributes} going={program.enrolled || undefined} />
            <OfficialCircleLink circleId={program.circleId} circleName={program.circleName} circleSlug={program.circleSlug} />

            {program.arrivalInstructions && (
              <div style={{ background: colors.greenBg, color: colors.greenText, borderRadius: 12, padding: "10px 14px", fontSize: 13.5, margin: "16px 0" }}>
                <strong>Arriving:</strong> {program.arrivalInstructions}
              </div>
            )}
            {!upcoming.length && (
              <div style={{ background: colors.panel, color: colors.muted, borderRadius: 12, padding: "10px 14px", fontSize: 13.5, margin: "16px 0" }}>
                No upcoming sessions scheduled — check back soon, or tell us you're interested below.
              </div>
            )}

            <div style={sectionDividerStyle} />

            {description && (
              <div style={{ marginBottom: 28 }}>
                <SectionHeading title="About this program" />
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

            {/* What to expect — same Swiss-style data blocks as ExperienceDetail. */}
            <div style={{ marginBottom: 28 }}>
              <SectionHeading title="What to expect" />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 40 }}>
                <div>
                  <CalendarIcon size={17} style={{ color: colors.mutedLight, marginBottom: 6 }} />
                  <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20 }}>{upcoming.length || "—"}</div>
                  <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 1 }}>Sessions to go</div>
                </div>
                {typicalDuration && (
                  <div>
                    <ClockIcon size={17} style={{ color: colors.mutedLight, marginBottom: 6 }} />
                    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20 }}>{formatDuration(typicalDuration)}</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 1 }}>Per session</div>
                  </div>
                )}
                {program.capacity !== null && (
                  <div>
                    <UsersIcon size={17} style={{ color: colors.mutedLight, marginBottom: 6 }} />
                    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20 }}>Up to {program.capacity}</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 1 }}>Group size</div>
                  </div>
                )}
                {program.skillLevel && (
                  <div>
                    <AwardIcon size={17} style={{ color: colors.mutedLight, marginBottom: 6 }} />
                    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20 }}>{program.skillLevel}</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 1 }}>Level</div>
                  </div>
                )}
              </div>
            </div>

            {/* Program details — structured label/value grid. */}
            <div style={{ marginBottom: 28 }}>
              <SectionHeading title="Program details" />
              <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                {detailFields.map((f) => (
                  <div key={f.label}>
                    <div style={factLabelStyle}>{f.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3, lineHeight: 1.4 }}>{f.value}</div>
                  </div>
                ))}
              </div>
            </div>

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

            <InfoBlock heading="Accessibility" body={program.accessibilityInfo} />
            <InfoBlock heading="Guardian rules" body={program.guardianRules} />
            <InfoBlock heading="Safeguarding" body={program.safeguardingInfo} />

            {/* Full schedule — upcoming first; past sessions behind a toggle. */}
            <div style={{ marginBottom: 28 }}>
              <SectionHeading title="Schedule" />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {upcoming.map((s, i) => (
                  <div key={s.id} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13.5, color: colors.muted }}>
                    <span style={{ fontWeight: 700, color: colors.text, minWidth: 24 }}>{i + 1}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><CalendarIcon size={13} /> {dateLabel(s.date)}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><ClockIcon size={13} /> {s.time} · {formatDuration(s.durationMinutes)}</span>
                    {s.instructorName && <span>{s.instructorName}</span>}
                    {s.roomName && <span>{s.roomName}</span>}
                  </div>
                ))}
                {upcoming.length === 0 && <p style={{ color: colors.faint, fontSize: 13.5, margin: 0 }}>No upcoming sessions scheduled yet.</p>}
                {past.length > 0 && (
                  <button onClick={() => setShowPast((v) => !v)} style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, marginTop: 4, fontSize: 13, fontWeight: 700, color: colors.muted, cursor: "pointer", textDecoration: "underline" }}>
                    {showPast ? "Hide past sessions" : `Show ${past.length} past session${past.length === 1 ? "" : "s"}`}
                  </button>
                )}
                {showPast &&
                  past.map((s) => (
                    <div key={s.id} style={{ borderRadius: 12, padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13, color: colors.faint, background: colors.panel }}>
                      <span>{dateLabel(s.date)}</span>
                      <span>{s.time}</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Hosted by — the provider behind this listing. */}
            {program.vendorName && (
              <div style={{ marginBottom: 28 }}>
                <SectionHeading title="Hosted by" />
                <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 14.5 }}>{program.vendorName}</span>
                    {program.vendorVerified && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px" }}>
                        <AwardIcon size={11} /> Verified provider
                      </span>
                    )}
                  </div>
                  {program.vendorId && (
                    <button
                      onClick={() => navigate(`/provider/${program.vendorId}`)}
                      style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer", textDecoration: "underline" }}
                    >
                      View provider
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Where — the venue, with a map when it has coordinates. */}
            <div style={{ marginBottom: 28 }}>
              <SectionHeading title="Where" />
              <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <PinIcon size={16} style={{ color: colors.mutedLight, flex: "none" }} />
                  <div>
                    <button onClick={() => navigate(venueHref)} style={{ background: "none", border: "none", padding: 0, fontWeight: 700, fontSize: 14.5, color: colors.text, cursor: "pointer", textAlign: "left" }}>
                      {program.listingName}
                    </button>
                    {(program.venueArea || program.venueCounty) && (
                      <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>
                        {[program.venueArea, program.venueCounty].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                </div>
                <a href={directionsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: colors.text, textDecoration: "underline", flex: "none" }}>
                  Get directions
                </a>
              </div>
              {program.venueLat != null && program.venueLng != null && <SinglePinMap lat={program.venueLat} lng={program.venueLng} label={program.listingName} height={240} />}
            </div>

            <div style={{ marginBottom: 28 }}>
              <Reviews listingType="program" listingId={program.id} accent={tone} />
            </div>

            {similar.length > 0 && (
              <div>
                <SectionHeading title="More like this" />
                <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }}>
                  {similar.map((p) => (
                    <div key={p.id} style={{ flex: "none", width: 260 }}>
                      <BrowseCard e={programToBrowseItem(p)} icon={<GridIcon size={24} />} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN — sticky enrol card, same rhythm as ExperienceDetail's. */}
          <div className="sticky-aside" style={{ position: "sticky", top: 90 }}>
            <Card>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: 0, color: joinHeadlineColor }}>{joinHeadline}</h2>
                {program.enrolled > 0 && program.capacity !== null && (
                  <p style={{ margin: "4px 0 0", fontSize: 12.5, color: colors.mutedLight }}>
                    {program.enrolled} of {program.capacity} enrolled
                  </p>
                )}
              </div>

              <div style={{ height: 1, background: colors.border, margin: "0 0 16px" }} />

              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, color: colors.muted, marginBottom: 16 }}>
                {next ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <CalendarIcon size={14} /> Starts {dateLabel(next.date)} · {next.time}
                  </span>
                ) : (
                  <span style={{ color: colors.faint }}>No upcoming sessions scheduled yet.</span>
                )}
                {upcoming.length > 1 && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <ClockIcon size={14} /> {upcoming.length} sessions{last ? ` · until ${dateLabel(last.date)}` : ""}
                  </span>
                )}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <PinIcon size={14} /> {venueLine || program.listingName}
                </span>
                <span style={{ fontWeight: 700, color: program.priceCents ? colors.text : colors.greenText }}>
                  {program.priceCents ? `${formatPrice(program.priceCents)} for the whole program` : "Free"}
                </span>
              </div>

              {upcoming.length > 0 && (
                <Button full disabled={!canEnroll} onClick={() => setEnrollOpen(true)}>
                  {full ? "Full" : "Enroll"}
                </Button>
              )}
              {canEnroll && !program.priceCents && <div style={{ textAlign: "center", fontSize: 12, color: colors.faint, marginTop: 8 }}>No payment required</div>}
            </Card>

            <Card style={{ marginTop: 16, background: colors.panel, border: "none" }}>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14, margin: "0 0 6px" }}>One sign-up, every session</h3>
              <p style={{ margin: 0, fontSize: 13, color: colors.mutedLight, lineHeight: 1.5 }}>
                Enrolling books a place on the whole program. You'll find it, and any updates from the venue, in My bookings.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <Modal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        title={`Enroll in ${program.title}`}
        subtitle={enrollSubtitle}
        footer={enrollFooter}
        confirmClose={enrollDirty ? { title: "Discard this enrolment?", message: "The details you've entered won't be saved." } : undefined}
      >
        {enrollForm}
      </Modal>

      {/* "Can't make this one?" — same mint band as ExperienceDetail/GameDetail. */}
      <section style={{ background: colors.greenBg }}>
        <div className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "48px 24px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 32 }}>
          <div style={{ maxWidth: 460 }}>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(22px, 2.8vw, 28px)", margin: "0 0 8px", letterSpacing: "-.01em", color: colors.greenText }}>
              Can't make this one?
            </h2>
            <p style={{ margin: 0, color: colors.muted, fontSize: 15 }}>
              Tell HelloCircle when you'd like to do this. We'll let you know when a program like it starts.
            </p>
          </div>
          <IntentCaptureForm activityLabel={program.category || program.title} county={program.venueCounty ?? ""} startHref="/programs" startLabel="Or browse more programs →" />
        </div>
      </section>

      {/* Mobile sticky bar — opens the same enrol popup as the desktop CTA. */}
      {canEnroll && (
        <div className="mobile-join-bar">
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display, color: joinHeadlineColor }}>{joinHeadline}</div>
            <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{formatPrice(program.priceCents)}</div>
          </div>
          <Button onClick={() => setEnrollOpen(true)} style={{ flex: "none" }}>
            Enroll
          </Button>
        </div>
      )}
    </div>
  );
}
