import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { bookExperienceSession, fetchExperience } from "../api";
import { BackLink } from "../components/BackLink";
import { CalendarIcon, ClockIcon, PinIcon, TreeIconSmall, UsersIcon } from "../components/icons";
import { Button, Card, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import { isValidEmail } from "../validate";
import type { Experience, ExperienceSessionSlot } from "../types";

// Adventures & Experiences detail page — the counterpart to
// ProgramDetail.tsx, but books ONE session (a specific departure) rather
// than enrolling in the whole listing at once.

const INFO_FIELDS: { key: keyof Experience; label: string }[] = [
  { key: "itinerary", label: "Itinerary" },
  { key: "fitnessRequirements", label: "Fitness requirements" },
  { key: "equipmentProvided", label: "What's provided" },
  { key: "equipmentRequired", label: "What to bring" },
  { key: "transportInfo", label: "Transport" },
  { key: "safetyInfo", label: "Safety" },
  { key: "weatherPolicy", label: "Weather policy" },
  { key: "eligibility", label: "Eligibility" },
  { key: "cancellationTerms", label: "Cancellation terms" },
];

export function ExperienceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [experience, setExperience] = useState<Experience | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<ExperienceSessionSlot | null>(null);
  const [form, setForm] = useState({ participantName: "", email: resident?.email ?? "", phone: "", partySize: 1 });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ ref: string } | null>(null);

  useEffect(() => {
    if (id) fetchExperience(id).then(setExperience).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (resident?.email) setForm((f) => ({ ...f, email: resident.email }));
  }, [resident]);

  const submit = async () => {
    if (!id || !selectedSession || !form.participantName || !isValidEmail(form.email)) {
      setError("A participant name, a valid email and a departure are required");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await bookExperienceSession(id, selectedSession.id, form);
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      setConfirmed({ ref: res.ref });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't complete booking");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSpinner />;
  if (!experience) {
    return (
      <section style={{ maxWidth: 640, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
        <p style={{ color: colors.mutedLight }}>This listing doesn't exist.</p>
      </section>
    );
  }

  if (confirmed) {
    return (
      <section style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 10px" }}>You're booked.</h1>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>{experience.title} · Reference {confirmed.ref}</p>
        <Button onClick={() => navigate("/bookings")}>View my bookings</Button>
      </section>
    );
  }

  const total = experience.priceCents * form.partySize;

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "26px 24px 80px" }}>
        <BackLink onClick={() => navigate(-1)}>Back</BackLink>

        <Card style={{ marginBottom: 20, padding: 0, overflow: "hidden" }}>
          <div
            style={{
              height: 200,
              background: experience.imageUrl ? `url(${experience.imageUrl}) center/cover` : experience.kind === "adventure" ? colors.greenBg : colors.orangeBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {!experience.imageUrl && <TreeIconSmall size={40} style={{ color: experience.kind === "adventure" ? colors.greenText : colors.orangeDark, opacity: 0.6 }} />}
          </div>
          <div style={{ padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 26, margin: "0 0 4px" }}>{experience.title}</h1>
                <div style={{ display: "flex", alignItems: "center", gap: 5, color: colors.mutedLight, fontSize: 14.5 }}>
                  <PinIcon size={13} /> {experience.area}{experience.area && experience.county ? ", " : ""}{experience.county}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: experience.kind === "adventure" ? colors.greenText : colors.orangeDark, background: experience.kind === "adventure" ? colors.greenBg : colors.orangeBg, borderRadius: 999, padding: "3px 10px", textTransform: "capitalize" }}>
                    {experience.kind}
                  </span>
                  {experience.difficulty && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: 999, padding: "3px 10px", textTransform: "capitalize" }}>{experience.difficulty}</span>
                  )}
                  <span style={{ fontSize: 12, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: 999, padding: "3px 10px" }}>{experience.durationMinutes} min</span>
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 20, whiteSpace: "nowrap" }}>{experience.priceCents ? `€${(experience.priceCents / 100).toFixed(2)}pp` : "Free"}</div>
            </div>
            {experience.description && <p style={{ margin: "16px 0 0", color: "#3B423C", fontSize: 15, lineHeight: 1.55 }}>{experience.description}</p>}
            {experience.meetingPoint && (
              <p style={{ margin: "10px 0 0", color: colors.muted, fontSize: 13.5 }}>Meeting point: {experience.meetingPoint}</p>
            )}
          </div>
        </Card>

        {INFO_FIELDS.some((f) => experience[f.key]) && (
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {INFO_FIELDS.filter((f) => experience[f.key]).map((f) => (
                <div key={f.key}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.muted, marginBottom: 3 }}>{f.label.toUpperCase()}</div>
                  <div style={{ fontSize: 14, color: "#3B423C", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{String(experience[f.key])}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: "0 0 12px" }}>Choose a departure</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
          {experience.sessions.map((s) => {
            const full = s.spotsLeft === 0;
            const selected = selectedSession?.id === s.id;
            return (
              <button
                key={s.id}
                onClick={() => !full && setSelectedSession(s)}
                disabled={full}
                style={{
                  textAlign: "left",
                  background: selected ? colors.greenBg : "#fff",
                  border: `1.5px solid ${selected ? colors.green : colors.border}`,
                  borderRadius: 12,
                  padding: "12px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: full ? "default" : "pointer",
                  opacity: full ? 0.55 : 1,
                }}
              >
                <span style={{ display: "flex", gap: 16, fontSize: 13.5, color: colors.muted }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><CalendarIcon size={13} /> {s.date}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><ClockIcon size={13} /> {s.time}</span>
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: full ? colors.danger : colors.greenText }}>
                  {full ? "Full" : `${s.spotsLeft} spot${s.spotsLeft === 1 ? "" : "s"} left`}
                </span>
              </button>
            );
          })}
          {experience.sessions.length === 0 && <p style={{ color: colors.faint, fontSize: 13.5 }}>No upcoming departures scheduled yet.</p>}
        </div>

        {selectedSession && (
          <Card>
            <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 14px" }}>Book this departure</h3>
            <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Your name</label>
                <input value={form.participantName} onChange={(e) => setForm((f) => ({ ...f, participantName: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Party size</label>
                <input
                  type="number"
                  min={1}
                  max={selectedSession.spotsLeft}
                  value={form.partySize}
                  onChange={(e) => setForm((f) => ({ ...f, partySize: Math.max(1, Number(e.target.value)) }))}
                  style={inputStyle}
                />
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
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 13.5, color: colors.muted }}>
              <UsersIcon size={14} /> {form.partySize} × €{(experience.priceCents / 100).toFixed(2)} = <strong>€{(total / 100).toFixed(2)}</strong>
            </div>
            {error && <p style={{ color: colors.danger, fontSize: 13, margin: "12px 0 0" }}>{error}</p>}
            <div style={{ marginTop: 16 }}>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? "Please wait…" : total ? `Continue to pay €${(total / 100).toFixed(2)}` : "Book for free"}
              </Button>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
