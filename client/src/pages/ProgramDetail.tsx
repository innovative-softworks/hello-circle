import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { enrollInProgram, fetchProgram } from "../api";
import { openCheckout } from "../native";
import { BackLink } from "../components/BackLink";
import { CalendarIcon, ClockIcon, UsersIcon } from "../components/icons";
import { AvailabilityBadge, availabilityFromSpots, Button, Card, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth, radius } from "../theme";
import { isValidEmail } from "../validate";
import type { Program } from "../types";
import { formatPrice } from "../formatters";

// Resident-facing Program detail (Phase B) — the "8-week course, one
// sign-up" counterpart to Activity/Facility detail. One enrollment covers
// every session shown below.

export function ProgramDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ participantName: "", participantDob: "", email: resident?.email ?? "", phone: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ ref: string } | null>(null);
  const enrollCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) fetchProgram(id).then(setProgram).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (resident?.email) setForm((f) => ({ ...f, email: resident.email }));
  }, [resident]);

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
      <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
        <p style={{ color: colors.mutedLight }}>This program doesn't exist.</p>
      </section>
    );
  }

  if (confirmed) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 10px" }}>You're enrolled.</h1>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>{program.title} · Reference {confirmed.ref}</p>
        <Button onClick={() => navigate("/bookings")}>View my bookings</Button>
      </section>
    );
  }

  const full = program.capacity !== null && program.spotsLeft === 0;
  const enrollLabel = submitting ? "Please wait…" : program.priceCents ? `Continue to pay €${(program.priceCents / 100).toFixed(2)}` : "Enroll for free";

  const enrollForm = (
    <>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 14px" }}>Enroll</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={labelStyle}>Participant name</label>
          <input value={form.participantName} onChange={(e) => setForm((f) => ({ ...f, participantName: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Date of birth (optional)</label>
          <input type="date" value={form.participantDob} onChange={(e) => setForm((f) => ({ ...f, participantDob: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Phone (optional)</label>
          <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} style={inputStyle} />
        </div>
      </div>
      {error && <p style={{ color: colors.danger, fontSize: 13, margin: "12px 0 0" }}>{error}</p>}
      <div style={{ marginTop: 16 }}>
        <Button onClick={submit} disabled={submitting} full>{enrollLabel}</Button>
      </div>
    </>
  );

  return (
    <>
    <div className="program-detail-mobile-pad" style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "26px 24px 80px" }}>
        <BackLink onClick={() => navigate(-1)}>Back</BackLink>

        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 40, alignItems: "start" }}>
          <div>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: "clamp(24px,3vw,30px)", margin: "0 0 4px", letterSpacing: "-.01em" }}>{program.title}</h1>
            <div style={{ color: colors.mutedLight, fontSize: 14.5, marginBottom: 10 }}>{program.listingName}{program.ageRange ? ` · ${program.ageRange}` : ""}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
              {program.category && (
                <span style={{ fontSize: 12, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "3px 10px" }}>{program.category}</span>
              )}
              {program.skillLevel && (
                <span style={{ fontSize: 12, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: radius.pill, padding: "3px 10px" }}>{program.skillLevel}</span>
              )}
              {program.capacity !== null && program.spotsLeft !== null && (
                <AvailabilityBadge state={full ? "full" : availabilityFromSpots(program.spotsLeft)}>
                  <UsersIcon size={12} /> {full ? "Full" : `${program.spotsLeft} of ${program.capacity} spots left`}
                </AvailabilityBadge>
              )}
            </div>

            {program.description && <p style={{ margin: "0 0 16px", color: colors.textSoft, fontSize: 15, lineHeight: 1.55 }}>{program.description}</p>}
            {program.instructorName && <p style={{ margin: "0 0 4px", color: colors.muted, fontSize: 13.5 }}>Instructor: {program.instructorName}</p>}
            {program.equipment.length > 0 && (
              <p style={{ margin: "0 0 4px", color: colors.muted, fontSize: 13.5 }}>Bring: {program.equipment.join(", ")}</p>
            )}
            {program.guardianRules && (
              <div style={{ background: colors.panel, borderRadius: radius.control, padding: "10px 12px", marginTop: 12 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.muted, marginBottom: 3 }}>GUARDIAN RULES</div>
                <p style={{ fontSize: 13, color: colors.textSoft, margin: 0, whiteSpace: "pre-wrap" }}>{program.guardianRules}</p>
              </div>
            )}
            {program.safeguardingInfo && (
              <div style={{ background: colors.panel, borderRadius: radius.control, padding: "10px 12px", marginTop: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.muted, marginBottom: 3 }}>SAFEGUARDING</div>
                <p style={{ fontSize: 13, color: colors.textSoft, margin: 0, whiteSpace: "pre-wrap" }}>{program.safeguardingInfo}</p>
              </div>
            )}

            <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: "28px 0 12px" }}>Full schedule</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {program.sessions.map((s) => (
                <div key={s.id} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13.5, color: colors.muted }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><CalendarIcon size={13} /> {s.date}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><ClockIcon size={13} /> {s.time} · {s.durationMinutes}min</span>
                  {s.instructorName && <span>{s.instructorName}</span>}
                  {s.roomName && <span>{s.roomName}</span>}
                </div>
              ))}
              {program.sessions.length === 0 && <p style={{ color: colors.faint, fontSize: 13.5 }}>No sessions scheduled yet.</p>}
            </div>
          </div>

          <div className="sticky-aside" style={{ position: "sticky", top: 90 }} ref={enrollCardRef}>
            <Card>
              <div style={{ fontWeight: 700, fontSize: 24, marginBottom: 4, fontFamily: fonts.display }}>
                {formatPrice(program.priceCents)}
              </div>
              {full ? (
                <p style={{ color: colors.muted, fontSize: 14 }}>This program is full — check back for a future intake.</p>
              ) : (
                enrollForm
              )}
            </Card>
          </div>
        </div>
      </section>
    </div>

    {!full && (
      <div className="mobile-join-bar">
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display }}>{program.title}</div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{formatPrice(program.priceCents)}</div>
        </div>
        {/* Scrolls to the enroll form rather than submitting directly — unlike
            Centre/ClubDetail's mobile bar (which navigates to a fresh page),
            this form's own validation errors render inside the rail card, so
            silently calling submit() from here could fail with no visible
            feedback at the bar's own scroll position. */}
        <Button style={{ flex: "none" }} onClick={() => enrollCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>
          Enroll
        </Button>
      </div>
    )}
    </>
  );
}
