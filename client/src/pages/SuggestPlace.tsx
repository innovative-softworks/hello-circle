import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyPlaceSuggestions, submitPlaceSuggestion } from "../api";
import { PinIcon } from "../components/icons";
import { Button, Card, StatusBadge, inputStyle, labelStyle } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { PageTitle } from "../components/PageTitle";
import { IRISH_COUNTY_COORDS } from "../irishCounties";
import { colors } from "../theme";
import type { PlaceSuggestion } from "../types";

// Community-contributed places (master-prompt punch list #4) — anyone
// (signed in or a pure guest, same client-id pattern as reports.ts) can
// suggest a venue that isn't listed yet. Admin approval auto-publishes it
// as a real unclaimed listing (see server/src/routes/admin.ts).

const COUNTIES = Object.keys(IRISH_COUNTY_COORDS).sort((a, b) => a.localeCompare(b));

export function SuggestPlacePage() {
  const navigate = useNavigate();
  const [suggestedName, setSuggestedName] = useState("");
  const [category, setCategory] = useState<"centre" | "club">("centre");
  const [area, setArea] = useState("");
  const [county, setCounty] = useState("");
  const [description, setDescription] = useState("");
  const [contactInfo, setContactInfo] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [mine, setMine] = useState<PlaceSuggestion[] | null>(null);
  const [showMine, setShowMine] = useState(false);

  const loadMine = async () => {
    setShowMine(true);
    if (mine) return;
    try {
      setMine(await fetchMyPlaceSuggestions());
    } catch {
      setMine([]);
    }
  };

  const handleSubmit = async () => {
    if (!suggestedName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPlaceSuggestion({
        suggestedName: suggestedName.trim(),
        category,
        area: area.trim() || undefined,
        county: county || undefined,
        description: description.trim() || undefined,
        contactInfo: contactInfo.trim() || undefined,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't submit this suggestion");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "26px 24px 80px" }}>
        <BackLink onClick={() => navigate(-1)} marginBottom={16}>Back</BackLink>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <PinIcon size={22} style={{ color: colors.greenText }} />
          <PageTitle style={{ margin: 0 }}>Suggest a place</PageTitle>
        </div>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 24px" }}>
          Know a community centre or club that isn't on HelloCircle yet? Tell us about it — our team reviews
          every suggestion, and approved places go live for everyone to find.
        </p>

        {done ? (
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 18, padding: 32, textAlign: "center" }}>
            <p style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>Thanks — we've got it.</p>
            <p style={{ color: colors.mutedLight, fontSize: 14, margin: "0 0 20px" }}>
              Our team will take a look. If it checks out, it'll be published as a real listing.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <Button onClick={() => navigate("/")}>Back to home</Button>
              <Button variant="ghost" onClick={loadMine}>See my suggestions</Button>
            </div>
          </div>
        ) : (
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>Place name</label>
                <input value={suggestedName} onChange={(e) => setSuggestedName(e.target.value)} placeholder="e.g. Clontarf Community Hall" style={inputStyle} />
              </div>
              <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={labelStyle}>Type</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value as "centre" | "club")} style={inputStyle}>
                    <option value="centre">Community centre / hall</option>
                    <option value="club">Club</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>County</label>
                  <select value={county} onChange={(e) => setCounty(e.target.value)} style={inputStyle}>
                    <option value="">Not sure</option>
                    {COUNTIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Area / town (optional)</label>
                <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Clontarf" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>What's it like? (optional)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What do they offer, who runs it, anything that'd help us find it"
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                />
              </div>
              <div>
                <label style={labelStyle}>Contact info (optional)</label>
                <input value={contactInfo} onChange={(e) => setContactInfo(e.target.value)} placeholder="Phone, email, or website if you know it" style={inputStyle} />
              </div>
              {error && <p style={{ color: colors.danger, fontSize: 13.5, margin: 0 }}>{error}</p>}
              <Button onClick={handleSubmit} disabled={submitting || !suggestedName.trim()}>
                {submitting ? "Submitting…" : "Submit suggestion"}
              </Button>
              <button
                type="button"
                onClick={loadMine}
                style={{ background: "none", border: "none", color: colors.mutedLight, fontSize: 13, cursor: "pointer", padding: 0, textAlign: "center" }}
              >
                See my suggestions
              </button>
            </div>
          </Card>
        )}

        {showMine && (
          <div style={{ marginTop: 24 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>Your suggestions</h4>
            {mine === null ? (
              <p style={{ color: colors.mutedLight, fontSize: 13.5 }}>Loading…</p>
            ) : mine.length === 0 ? (
              <p style={{ color: colors.mutedLight, fontSize: 13.5 }}>Nothing submitted from this device yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {mine.map((s) => (
                  <div key={s.id} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{s.suggestedName}</div>
                      <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{s.area ? `${s.area}, ` : ""}{s.county || "Ireland"}</div>
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
