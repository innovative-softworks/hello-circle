import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { addFavourite, bookExperienceSession, downloadExperienceBookingIcs, fetchExperience, fetchExperiences, fetchFavourites, removeFavourite } from "../api";
import { openCheckout } from "../native";
import { BackLink } from "../components/BackLink";
import { ExperienceCard } from "../components/ExperienceCard";
import { NumberStepper } from "../components/form";
import { AwardIcon, CalendarIcon, CheckIcon, ClockIcon, HeartIcon, PinIcon, TreeIconSmall, TrendUpIcon, UsersIcon } from "../components/icons";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { InviteSheetButton } from "../components/InviteSheetButton";
import { Photo } from "../components/Photo";
import { Reviews } from "../components/Reviews";
import { ShareButton } from "../components/ShareButton";
import { SinglePinMap } from "../components/SinglePinMap";
import { Button, Card, Drawer, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { isFavorite, toggleFavorite } from "../favorites";
import { useGuest } from "../GuestContext";
import { dateLabel } from "../euro";
import { colors, fonts, maxWidth, photoOverlay, radius } from "../theme";
import { isValidEmail } from "../validate";
import type { Experience, ExperienceSessionSlot } from "../types";
import { formatPrice } from "../formatters";

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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function nextSession(e: Experience): ExperienceSessionSlot | null {
  return e.sessions[0] ?? null;
}

function formatDuration(minutes: number): string {
  if (!minutes) return "";
  if (minutes % 60 === 0 && minutes >= 60) return `${minutes / 60}h`;
  if (minutes > 60) return `${(minutes / 60).toFixed(1)}h`;
  return `${minutes} min`;
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

// Right-rail facts card — mirrors GameDetail's GoodToKnow card exactly.
function GoodToKnow({ e }: { e: Experience }) {
  const fields: { label: string; value: string }[] = [];
  if (e.durationMinutes) fields.push({ label: "Duration", value: formatDuration(e.durationMinutes) });
  fields.push({ label: "Group size", value: `Up to ${e.capacity}` });
  if (e.difficulty) fields.push({ label: "Difficulty", value: capitalize(e.difficulty) });
  if (e.terrainType) fields.push({ label: "Terrain", value: e.terrainType });
  fields.push({ label: "Payment", value: e.paymentMethod === "cash" ? "Cash on the day" : "Pay online" });

  return (
    <Card style={{ marginTop: 16 }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 12px" }}>Good to know</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {fields.map((f) => (
          <div key={f.label}>
            <div style={factLabelStyle}>{f.label}</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 3, lineHeight: 1.4 }}>{f.value}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Subtle supporting card — mirrors GameDetail's CancellationCard exactly
// (panel background, no border).
function CancellationCard({ e }: { e: Experience }) {
  return (
    <Card style={{ marginTop: 16, background: colors.panel, border: "none" }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14, margin: "0 0 6px" }}>Cancellation & updates</h3>
      <p style={{ margin: 0, fontSize: 13, color: colors.mutedLight, lineHeight: 1.5 }}>
        {e.cancellationTerms || "Plans can change. Check back here for updates before you go."}
      </p>
    </Card>
  );
}

export function ExperienceDetail() {
  // Slugs (master-prompt punch list #1) — same convention as centres/clubs;
  // booking submits with experience.id once loaded, never this raw param.
  const { id: idOrSlug } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [experience, setExperience] = useState<Experience | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [similar, setSimilar] = useState<Experience[]>([]);
  const [activePhoto, setActivePhoto] = useState(0);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<ExperienceSessionSlot | null>(null);
  const [form, setForm] = useState({ participantName: "", email: resident?.email ?? "", phone: "", partySize: 1 });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ ref: string } | null>(null);

  const load = () => {
    if (!idOrSlug) return;
    setLoadError(false);
    setActivePhoto(0);
    setDescriptionExpanded(false);
    fetchExperience(idOrSlug)
      .then(setExperience)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, [idOrSlug]);

  useEffect(() => {
    if (resident?.email) setForm((f) => ({ ...f, email: resident.email }));
  }, [resident]);

  useEffect(() => {
    if (!experience) return;
    if (resident) {
      // Server-side favourite for a signed-in resident — same pattern
      // DiscoverCard.tsx already uses for games/program/club sessions.
      fetchFavourites().then((rows) => setSaved(rows.some((r) => r.listingType === "experience" && r.listingId === experience.id)));
    } else {
      setSaved(isFavorite("experience", experience.id));
    }
  }, [resident, experience]);

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

  const handleToggleSave = async () => {
    if (!experience) return;
    if (resident) {
      const next = !saved;
      setSaved(next);
      if (next) await addFavourite("experience", experience.id);
      else await removeFavourite("experience", experience.id);
    } else {
      setSaved(toggleFavorite("experience", experience.id));
    }
  };

  const photos = useMemo(() => (experience ? [experience.imageUrl, ...experience.images].filter(Boolean) : []), [experience]);

  const submit = async () => {
    if (!experience || !selectedSession || !form.participantName || !isValidEmail(form.email)) {
      setError("A participant name, a valid email and a departure are required");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await bookExperienceSession(experience.id, selectedSession.id, form);
      if (res.url) {
        openCheckout(res.url);
        return;
      }
      setBookingOpen(false);
      setConfirmed({ ref: res.ref });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't complete booking");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSpinner />;

  const browsePath = experience ? (experience.kind === "adventure" ? "/adventures" : "/experiences") : "/adventures";
  const browseLabel = experience?.kind === "adventure" ? "All adventures" : "All experiences";

  if (loadError) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 10px" }}>We couldn't load this adventure.</h1>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
          <Button onClick={load}>Try again</Button>
          <Button variant="ghost" onClick={() => navigate(browsePath)}>Browse listings</Button>
        </div>
      </section>
    );
  }

  if (!experience) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 10px" }}>This adventure is no longer available.</h1>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>It may have been removed by its host.</p>
        <Button onClick={() => navigate(browsePath)}>Find something similar</Button>
      </section>
    );
  }

  if (confirmed) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 10px" }}>You're booked.</h1>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>{experience.title} · Reference {confirmed.ref}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={() => downloadExperienceBookingIcs(confirmed.ref)}>Add to calendar</Button>
          <InviteSheetButton entityType={experience.kind === "adventure" ? "adventure" : "experience"} entityId={experience.id} title={experience.title} />
          <Button onClick={() => navigate("/bookings")}>View my bookings</Button>
        </div>
      </section>
    );
  }

  const session = nextSession(experience);
  const joined = session ? Math.max(0, session.capacity - session.spotsLeft) : 0;
  const full = session ? session.spotsLeft === 0 : false;
  const description = experience.description || "";
  const descriptionIsLong = description.length > 320;
  const visibleDescription = descriptionExpanded || !descriptionIsLong ? description : `${description.slice(0, 320).trimEnd()}…`;
  const kindLabel = experience.kind === "adventure" ? "Adventure" : "Experience";
  const kindAccent = experience.kind === "adventure" ? colors.green : colors.orange;
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${experience.meetingPoint || experience.title}, ${experience.area}, ${experience.county}`)}`;

  const detailFields: { label: string; value: string }[] = [
    { label: "Date & time", value: session ? `${dateLabel(session.date)} · ${session.time}` : "No upcoming departures" },
    { label: "Location", value: `${experience.area}${experience.area && experience.county ? ", " : ""}${experience.county}` },
    ...(experience.durationMinutes ? [{ label: "Duration", value: formatDuration(experience.durationMinutes) }] : []),
    ...(experience.distanceKm !== null ? [{ label: "Distance", value: `${experience.distanceKm} km` }] : []),
    ...(experience.elevationGainM !== null ? [{ label: "Elevation gain", value: `${experience.elevationGainM} m` }] : []),
    ...(experience.difficulty ? [{ label: "Difficulty", value: capitalize(experience.difficulty) }] : []),
    { label: "Group size", value: `Up to ${experience.capacity}` },
    { label: "Price", value: formatPrice(experience.priceCents, { each: true }) },
    ...(experience.terrainType ? [{ label: "Terrain", value: experience.terrainType }] : []),
    ...(experience.eligibility ? [{ label: "Requirements", value: experience.eligibility }] : []),
  ];

  const safetyLines = experience.safetyInfo.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  const joinHeadline = !session
    ? "No dates yet"
    : full
    ? "Full"
    : session.spotsLeft === 1
    ? "1 spot left"
    : `${session.spotsLeft} spots left`;
  const joinHeadlineColor = !session ? colors.muted : full ? colors.muted : session.spotsLeft <= 3 ? colors.orangeDark : colors.text;
  const anyAvailable = experience.sessions.some((s) => s.spotsLeft > 0);
  const registerLabel = experience.kind === "adventure" ? "Book this adventure" : "Register for this experience";
  // The step-2 submit verb ("Book"/"Register") tracks the same per-kind
  // choice as `registerLabel` above, so a free experience's flow doesn't
  // open on "Register for this experience" and then submit as "Book for
  // free" — same action, same verb, both steps.
  const submitVerb = experience.kind === "adventure" ? "Book" : "Register";

  const bookingForm = (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: selectedSession ? 20 : 0 }}>
        {experience.sessions.map((s) => {
          const sFull = s.spotsLeft === 0;
          const selected = selectedSession?.id === s.id;
          return (
            <button
              key={s.id}
              onClick={() => !sFull && setSelectedSession(s)}
              disabled={sFull}
              style={{
                textAlign: "left",
                background: selected ? colors.greenBg : colors.surface,
                border: `1.5px solid ${selected ? colors.green : colors.border}`,
                borderRadius: 12,
                padding: "12px 14px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                cursor: sFull ? "default" : "pointer",
                opacity: sFull ? 0.55 : 1,
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13, color: colors.muted }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><CalendarIcon size={13} /> {s.date}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><ClockIcon size={13} /> {s.time}</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: sFull ? colors.muted : colors.greenText }}>
                {sFull ? "Full" : `${s.spotsLeft} left`}
              </span>
            </button>
          );
        })}
        {experience.sessions.length === 0 && <p style={{ color: colors.faint, fontSize: 13.5, margin: 0 }}>No upcoming departures scheduled yet.</p>}
      </div>

      {selectedSession && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={labelStyle}>Your name</label>
              <input value={form.participantName} onChange={(e) => setForm((f) => ({ ...f, participantName: e.target.value }))} style={inputStyle} />
            </div>
            <NumberStepper
              label="Party size"
              value={form.partySize}
              onChange={(n) => setForm((f) => ({ ...f, partySize: n }))}
              min={1}
              max={selectedSession.spotsLeft}
            />
            <div>
              <label style={labelStyle}>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Phone (optional)</label>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 13, color: colors.muted }}>
            <UsersIcon size={13} /> {form.partySize} × €{(experience.priceCents / 100).toFixed(2)} = <strong>€{((experience.priceCents * form.partySize) / 100).toFixed(2)}</strong>
          </div>
          {error && <p style={{ color: colors.danger, fontSize: 13, margin: "12px 0 0" }}>{error}</p>}
          <div style={{ marginTop: 16 }}>
            <Button onClick={submit} disabled={submitting} full>
              {submitting ? "Please wait…" : experience.priceCents * form.partySize ? `Continue to pay €${((experience.priceCents * form.partySize) / 100).toFixed(2)}` : `${submitVerb} for free`}
            </Button>
          </div>
          {!(experience.priceCents * form.partySize) && (
            <div style={{ textAlign: "center", fontSize: 12, color: colors.faint, marginTop: 8 }}>No payment required</div>
          )}
        </>
      )}
    </>
  );

  return (
    <div className="experience-detail-mobile-pad" style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "26px 24px 90px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
          <BackLink onClick={() => navigate(browsePath)} marginBottom={0}>{browseLabel}</BackLink>
          <div style={{ display: "flex", gap: 10 }}>
            <ShareButton entityType={experience.kind === "adventure" ? "adventure" : "experience"} entityId={experience.id} render={(onClick) => <button onClick={onClick} style={outlineButtonStyle}>Share</button>} />
            <button onClick={handleToggleSave} style={{ ...outlineButtonStyle, color: saved ? colors.orange : colors.text }}>
              <HeartIcon size={14} filled={saved} /> {saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 32, alignItems: "start" }}>
          {/* LEFT COLUMN */}
          <div>
            {/* HERO — same badge-overlaid Photo treatment as GameDetail's own
                hero: date/time pill top-left, spots-left pill top-right,
                height 340 / radius 20. A small dot selector below (not a
                thumbnail grid) is the one addition, since unlike a Game an
                Experience/Adventure can carry several real photos. */}
            <Photo
              src={photos[activePhoto] || undefined}
              alt={experience.title}
              ph={experience.kind === "adventure" ? colors.greenBg : colors.orangeBg}
              icon={<TreeIconSmall size={40} />}
              iconColor={kindAccent}
              style={{ height: 340, borderRadius: 20, marginBottom: photos.length > 1 ? 10 : 24 }}
              contentStyle={{ padding: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}
            >
              {session ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: photoOverlay.whiteBg, color: colors.text, borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 700 }}>
                  <CalendarIcon size={13} /> {dateLabel(session.date)} · {session.time}
                </span>
              ) : <span />}
              {session && (
                <span
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, borderRadius: radius.pill, padding: "6px 12px", fontSize: 13, fontWeight: 700,
                    background: full ? photoOverlay.whiteBg : photoOverlay.goldBg,
                    color: full ? colors.muted : photoOverlay.goldText,
                  }}
                >
                  {full ? "Full" : `${session.spotsLeft} spot${session.spotsLeft === 1 ? "" : "s"} left`}
                </span>
              )}
            </Photo>
            {photos.length > 1 && (
              <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
                {photos.map((p, i) => (
                  <button
                    key={p}
                    onClick={() => setActivePhoto(i)}
                    aria-label={`Photo ${i + 1}`}
                    style={{ width: 8, height: 8, borderRadius: "50%", border: "none", padding: 0, cursor: "pointer", background: i === activePhoto ? colors.dark : colors.borderStrong }}
                  />
                ))}
              </div>
            )}

            {/* Eyebrow (kind) + title + price row — same position/weight as
                GameDetail's own eyebrow/title/price row. */}
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>
              {kindLabel}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 28, margin: 0, letterSpacing: "-.01em" }}>{experience.title}</h1>
              <div style={{ flex: "none" }}>
                {experience.priceCents ? (
                  <div style={{ fontWeight: 800, fontSize: 22, color: colors.text }}>€{(experience.priceCents / 100).toFixed(2)}</div>
                ) : (
                  <div style={{ fontWeight: 700, fontSize: 14, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "4px 12px" }}>Free</div>
                )}
              </div>
            </div>
            {experience.blurb && <p style={{ margin: "6px 0 0", fontSize: 15, color: colors.mutedLight, lineHeight: 1.5 }}>{experience.blurb}</p>}
            <div style={{ display: "flex", alignItems: "center", gap: 5, color: colors.mutedLight, fontSize: 13.5, marginTop: 8 }}>
              <PinIcon size={13} /> {experience.area}{experience.area && experience.county ? ", " : ""}{experience.county}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13.5, color: colors.muted, marginTop: 10 }}>
              {[
                experience.durationMinutes ? formatDuration(experience.durationMinutes) : null,
                experience.difficulty ? capitalize(experience.difficulty) : null,
                `Up to ${experience.capacity}`,
              ]
                .filter((v): v is string => !!v)
                .map((item, i) => (
                  <span key={item}>
                    {i > 0 && <span style={{ margin: "0 8px 0 0", color: colors.faint }}>·</span>}
                    {item}
                  </span>
                ))}
            </div>

            {experience.meetingPoint && (
              <div style={{ background: colors.greenBg, color: colors.greenText, borderRadius: 12, padding: "10px 14px", fontSize: 13.5, margin: "16px 0" }}>
                <strong>Meeting point:</strong> {experience.meetingPoint}
              </div>
            )}
            {!session && (
              <div style={{ background: colors.panel, color: colors.muted, borderRadius: 12, padding: "10px 14px", fontSize: 13.5, margin: "16px 0" }}>
                No upcoming departures scheduled yet — check back soon.
              </div>
            )}

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

            {/* What to expect — Swiss-style data blocks (icon, bold value,
                muted label), same idea as GameDetail's QuickAttributes line
                but given its own section since there's more to say here. */}
            <div style={{ marginBottom: 28 }}>
              <SectionHeading title="What to expect" />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 40 }}>
                {experience.durationMinutes > 0 && (
                  <div>
                    <ClockIcon size={17} style={{ color: colors.mutedLight, marginBottom: 6 }} />
                    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20 }}>{formatDuration(experience.durationMinutes)}</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 1 }}>Total duration</div>
                  </div>
                )}
                {experience.distanceKm !== null && (
                  <div>
                    <PinIcon size={17} style={{ color: colors.mutedLight, marginBottom: 6 }} />
                    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20 }}>{experience.distanceKm} km</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 1 }}>Distance</div>
                  </div>
                )}
                {experience.elevationGainM !== null && (
                  <div>
                    <TrendUpIcon size={17} style={{ color: colors.mutedLight, marginBottom: 6 }} />
                    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20 }}>{experience.elevationGainM} m</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 1 }}>Elevation gain</div>
                  </div>
                )}
                {experience.difficulty && (
                  <div>
                    <TrendUpIcon size={17} style={{ color: colors.mutedLight, marginBottom: 6 }} />
                    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20 }}>{capitalize(experience.difficulty)}</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 1 }}>Difficulty</div>
                  </div>
                )}
                <div>
                  <UsersIcon size={17} style={{ color: colors.mutedLight, marginBottom: 6 }} />
                  <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20 }}>Up to {experience.capacity}</div>
                  <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 1 }}>Group size</div>
                </div>
              </div>
            </div>

            {/* Adventure/Experience details — structured label/value grid. */}
            <div style={{ marginBottom: 28 }}>
              <SectionHeading title={`${kindLabel} details`} />
              <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                {detailFields.map((f) => (
                  <div key={f.label}>
                    <div style={factLabelStyle}>{f.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3, lineHeight: 1.4 }}>{f.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* What to bring */}
            {(experience.equipmentProvided || experience.equipmentRequired) && (
              <div style={{ marginBottom: 28 }}>
                <SectionHeading title="What to bring" />
                <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                  {experience.equipmentProvided && (
                    <div>
                      <div style={factLabelStyle}>We provide</div>
                      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3, lineHeight: 1.4, color: colors.textSoft }}>{experience.equipmentProvided}</div>
                    </div>
                  )}
                  {experience.equipmentRequired && (
                    <div>
                      <div style={factLabelStyle}>You bring</div>
                      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3, lineHeight: 1.4, color: colors.textSoft }}>{experience.equipmentRequired}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <InfoBlock heading="Itinerary" body={experience.itinerary} />
            <InfoBlock heading="Fitness requirements" body={experience.fitnessRequirements} />
            <InfoBlock heading="Transport" body={experience.transportInfo} />
            <InfoBlock heading="Weather policy" body={experience.weatherPolicy} />

            {/* Hosted by — the real vendor behind this listing (businessName-
                or-name + a verified badge off provider_tier), linking to
                their public provider profile. Adventures/Experiences are
                vendor-listed, not resident-hosted like a Game, so this is a
                business, not a person — deliberately not styled like a
                personal host avatar. */}
            {experience.vendorName && (
              <div style={{ marginBottom: 28 }}>
                <SectionHeading title="Hosted by" />
                <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 14.5 }}>{experience.vendorName}</span>
                    {experience.vendorVerified && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px" }}>
                        <AwardIcon size={11} /> Verified provider
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => navigate(`/provider/${experience.vendorId}`)}
                    style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer", textDecoration: "underline" }}
                  >
                    View provider
                  </button>
                </div>
              </div>
            )}

            {/* Meeting point — same bordered-row + map pattern GameLocationCard uses. */}
            {experience.lat !== null && experience.lng !== null && (
              <div style={{ marginBottom: 28 }}>
                <SectionHeading title="Meeting point" />
                <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <PinIcon size={16} style={{ color: colors.mutedLight, flex: "none" }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{experience.meetingPoint || experience.title}</div>
                      {experience.area && <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>{experience.area}{experience.area && experience.county ? ", " : ""}{experience.county}</div>}
                    </div>
                  </div>
                  <a href={directionsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: colors.text, textDecoration: "underline", flex: "none" }}>
                    Get directions
                  </a>
                </div>
                <SinglePinMap lat={experience.lat} lng={experience.lng} label={experience.title} height={240} />
              </div>
            )}

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
              <Reviews listingType="experience" listingId={experience.id} accent={experience.kind === "adventure" ? "green" : "orange"} />
            </div>

            {/* Related listings */}
            {similar.length > 0 && (
              <div>
                <SectionHeading title="More like this" />
                <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }}>
                  {similar.map((e) => (
                    <div key={e.id} style={{ flex: "none", width: 240 }}>
                      <ExperienceCard e={e} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN — sticky Join card, mirroring GameJoinCard's own
              headline / social-proof / divider / info / CTA rhythm. Booking
              itself (session picker + form) now lives in a popup Drawer,
              opened by the CTA button below, rather than sitting inline in
              this card. */}
          <div className="sticky-aside" style={{ position: "sticky", top: 90 }}>
            <Card>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: 0, color: joinHeadlineColor }}>{joinHeadline}</h2>
                {session && joined > 0 && (
                  <p style={{ margin: "4px 0 0", fontSize: 12.5, color: colors.mutedLight }}>{joined} of {session.capacity} people joined</p>
                )}
              </div>

              <div style={{ height: 1, background: colors.border, margin: "0 0 16px" }} />

              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, color: colors.muted, marginBottom: 16 }}>
                {session ? (
                  <>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><CalendarIcon size={14} /> {dateLabel(session.date)} · {session.time}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><PinIcon size={14} /> {experience.area}{experience.area && experience.county ? ", " : ""}{experience.county}</span>
                    <span style={{ fontWeight: 700, color: experience.priceCents ? colors.text : colors.greenText }}>{formatPrice(experience.priceCents, { each: true })}</span>
                  </>
                ) : (
                  <span style={{ color: colors.faint }}>No upcoming departures scheduled yet.</span>
                )}
              </div>

              {experience.sessions.length > 0 && (
                <Button full disabled={!anyAvailable} onClick={() => setBookingOpen(true)}>
                  {anyAvailable ? registerLabel : "Full"}
                </Button>
              )}
              {anyAvailable && !experience.priceCents && (
                <div style={{ textAlign: "center", fontSize: 12, color: colors.faint, marginTop: 8 }}>No payment required</div>
              )}
            </Card>
            <GoodToKnow e={experience} />
            <CancellationCard e={experience} />
          </div>
        </div>
      </section>

      <Drawer open={bookingOpen} onClose={() => setBookingOpen(false)} title={registerLabel} size="wide">
        {bookingForm}
      </Drawer>

      {/* "Can't make this one?" — full-width mint band, same treatment as
          GameDetail's own closing band (pale mint background, dark green
          title, compact form/actions). */}
      <section style={{ background: colors.greenBg }}>
        <div className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "48px 24px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 32 }}>
          <div style={{ maxWidth: 460 }}>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(22px, 2.8vw, 28px)", margin: "0 0 8px", letterSpacing: "-.01em", color: colors.greenText }}>
              Can't make this one?
            </h2>
            <p style={{ margin: 0, color: colors.muted, fontSize: 15 }}>
              Tell HelloCircle when you'd like to do this. We'll let you know when something matches your interest.
            </p>
          </div>
          <IntentCaptureForm
            activityLabel={experience.title}
            county={experience.county ?? ""}
            startHref={browsePath}
            startLabel={`Or browse more ${experience.kind === "adventure" ? "adventures" : "experiences"} →`}
          />
        </div>
      </section>

      {/* Mobile sticky bar — same fixed-above-tab-bar pattern as
          GameJoinCard's own MobileJoinBar. Unlike a Game there's no
          single-tap join (booking needs a session + a short form), so this
          opens the same booking Drawer the desktop CTA does. */}
      {anyAvailable && (
        <div className="mobile-join-bar">
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display, color: joinHeadlineColor }}>{joinHeadline}</div>
            <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{formatPrice(experience.priceCents)}</div>
          </div>
          <Button onClick={() => setBookingOpen(true)} style={{ flex: "none" }}>{registerLabel}</Button>
        </div>
      )}
    </div>
  );
}
