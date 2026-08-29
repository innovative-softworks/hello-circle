import { useState } from "react";
import { applyToBecomeHost } from "../api";
import { AwardIcon } from "./icons";
import { Button, inputStyle, labelStyle } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { HostStatus } from "../types";

// Host guidelines (IA spec §15) — static content, no versioning/re-consent
// flow for v1 (see the plan's own explicit scope note). The checkbox below
// is the "explicit acceptance" the spec asks for; submitting the form
// itself still doubles as the acceptance record server-side (no separate
// accept-guidelines endpoint), same as before this pass.
const HOST_GUIDELINES = [
  "Be honest about the activity — skill level, what to bring, and roughly how long it runs.",
  "Show up, or cancel with enough notice for people to make other plans.",
  "Everyone gets treated with respect, regardless of ability or experience.",
  "No promoting anything unrelated to the activity — this isn't an ad slot.",
  "Follow the venue's own rules if you're hosting at a community centre or club.",
];

// "Host" trust tier (IA spec five-layer audit) — badge-only for v1: a
// resident who applies and is admin-approved gets a "Verified Host" badge
// shown to other participants on any Game/Circle they create (see
// GameDetail.tsx/CircleDetail.tsx). Never a requirement to host — any
// resident can still create a Game/Circle exactly as before applying here.
// Shown inside MyBookings.tsx's ("My Life") Profile tab, which already
// fetches the resident's host_status/bio/phone via fetchResidentFull().

export function HostApplicationPanel({
  hostStatus,
  hostBio,
  hostPhone,
  onApplied,
}: {
  hostStatus: HostStatus;
  hostBio: string;
  hostPhone: string;
  onApplied: () => void;
}) {
  const [bio, setBio] = useState(hostBio);
  const [phone, setPhone] = useState(hostPhone);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!bio.trim()) {
      setError("A short bio is required");
      return;
    }
    if (!agreed) {
      setError("Please confirm you've read and agree to the Host Guidelines");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await applyToBecomeHost({ bio, phone });
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't submit your application");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <AwardIcon size={16} style={{ color: colors.greenText }} />
        <span style={{ fontFamily: fonts.display, fontSize: 15, fontWeight: 700 }}>Become a Host</span>
      </div>

      {hostStatus === "verified" && (
        <>
          <p style={{ fontSize: 13, color: colors.greenText, fontWeight: 600, margin: "8px 0 12px" }}>
            You're a Verified Host — this shows next to your name on any Game or Circle you create.
          </p>
          <label style={labelStyle}>Bio</label>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} disabled />
        </>
      )}

      {hostStatus === "pending" && (
        <p style={{ fontSize: 13, color: colors.mutedLight, margin: "8px 0 0" }}>
          Application under review — we'll let you know once an admin has taken a look.
        </p>
      )}

      {(hostStatus === "none" || hostStatus === "rejected") && (
        <>
          <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "8px 0 12px" }}>
            A short review by an admin, then a "Verified Host" badge appears next to your name on any Game or
            Circle you create — you can host either way, this just adds a trust signal for other participants.
          </p>
          {hostStatus === "rejected" && (
            <p style={{ fontSize: 12.5, color: colors.orangeDark, margin: "0 0 12px" }}>
              Your last application wasn't approved — you're welcome to apply again.
            </p>
          )}
          <label style={labelStyle}>Short bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            placeholder="A sentence or two about you and what you like hosting"
            style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }}
          />
          <label style={labelStyle}>Phone (optional)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }} />

          <div style={{ background: colors.panel, borderRadius: radius.control, padding: "12px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Host Guidelines</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              {HOST_GUIDELINES.map((g) => (
                <li key={g} style={{ fontSize: 12, color: colors.mutedLight }}>{g}</li>
              ))}
            </ul>
          </div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: colors.mutedLight, marginBottom: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ accentColor: colors.green, marginTop: 2 }} />
            I've read and agree to the Host Guidelines above
          </label>

          {error && <p style={{ color: colors.danger, fontSize: 13, margin: "0 0 10px" }}>{error}</p>}
          <Button onClick={submit} disabled={submitting || !agreed}>
            {submitting ? "Submitting…" : "Apply to become a Host"}
          </Button>
        </>
      )}
    </div>
  );
}
