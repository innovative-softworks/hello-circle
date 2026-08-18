import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { enrollInProgram, fetchProgram } from "../api";
import { CalendarIcon, ChevronLeftIcon, ClockIcon, UsersIcon } from "../components/icons";
import { Button, Card, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import { isValidEmail } from "../validate";
import type { Program } from "../types";

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
        window.location.href = res.url;
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
      <section style={{ maxWidth: 640, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
        <p style={{ color: colors.mutedLight }}>This program doesn't exist.</p>
      </section>
    );
  }

  if (confirmed) {
    return (
      <section style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 10px" }}>You're enrolled.</h1>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>{program.title} · Reference {confirmed.ref}</p>
        <Button onClick={() => navigate("/bookings")}>View my bookings</Button>
      </section>
    );
  }

  const full = program.capacity !== null && program.spotsLeft === 0;

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "26px 24px 80px" }}>
        <button
          onClick={() => navigate(-1)}
          style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", color: colors.muted, fontWeight: 600, fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 20 }}
        >
          <ChevronLeftIcon size={14} style={{ marginRight: 4 }} /> Back
        </button>

        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 26, margin: "0 0 4px" }}>{program.title}</h1>
              <div style={{ color: colors.mutedLight, fontSize: 14.5 }}>{program.listingName}{program.ageRange ? ` · ${program.ageRange}` : ""}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {program.category && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "3px 10px" }}>{program.category}</span>
                )}
                {program.skillLevel && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: 999, padding: "3px 10px" }}>{program.skillLevel}</span>
                )}
              </div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{program.priceCents ? `€${(program.priceCents / 100).toFixed(2)}` : "Free"}</div>
          </div>
          {program.description && <p style={{ margin: "16px 0 0", color: "#3B423C", fontSize: 15, lineHeight: 1.55 }}>{program.description}</p>}
          {program.instructorName && <p style={{ margin: "10px 0 0", color: colors.muted, fontSize: 13.5 }}>Instructor: {program.instructorName}</p>}
          {program.equipment.length > 0 && (
            <p style={{ margin: "6px 0 0", color: colors.muted, fontSize: 13.5 }}>Bring: {program.equipment.join(", ")}</p>
          )}
          {program.capacity !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 13.5, color: full ? "#b00020" : colors.greenText, fontWeight: 700 }}>
              <UsersIcon size={14} /> {full ? "Full" : `${program.spotsLeft} of ${program.capacity} spots left`}
            </div>
          )}
        </Card>

        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: "0 0 12px" }}>Full schedule</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
          {program.sessions.map((s) => (
            <div key={s.id} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13.5, color: colors.muted }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><CalendarIcon size={13} /> {s.date}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><ClockIcon size={13} /> {s.time} · {s.durationMinutes}min</span>
              {s.instructorName && <span>{s.instructorName}</span>}
              {s.roomName && <span>{s.roomName}</span>}
            </div>
          ))}
          {program.sessions.length === 0 && <p style={{ color: colors.faint, fontSize: 13.5 }}>No sessions scheduled yet.</p>}
        </div>

        {!full && (
          <Card>
            <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 14px" }}>Enroll</h3>
            <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
            {error && <p style={{ color: "#b00020", fontSize: 13, margin: "12px 0 0" }}>{error}</p>}
            <div style={{ marginTop: 16 }}>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? "Please wait…" : program.priceCents ? `Continue to pay €${(program.priceCents / 100).toFixed(2)}` : "Enroll for free"}
              </Button>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
