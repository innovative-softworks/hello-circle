import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createCircle, fetchCircleSuggestions, fetchCircles, joinCircle, leaveCircle } from "../api";
import { UsersIcon } from "../components/icons";
import { Button, Card, EmptyState, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { PageTitle } from "../components/PageTitle";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import type { Circle, CircleSuggestion } from "../types";

// Circles (NEXT) — a persistent group anchored to recurring participation
// (see Games), not a generic social feed: no posts, no likes, just
// membership + what's coming up. Deliberately minimal v1.

export function Circles() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", activityLabel: "", area: "", county: "" });

  // Repetition-detection → "Make this a Circle?" (Phase 8) — activities
  // where this resident keeps playing games with the same 2+ people.
  const [suggestions, setSuggestions] = useState<CircleSuggestion[]>([]);
  const [suggestionBusy, setSuggestionBusy] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchCircles()
      .then(setCircles)
      .finally(() => setLoading(false));
  };

  const loadSuggestions = () => {
    if (resident) fetchCircleSuggestions().then(setSuggestions).catch(() => setSuggestions([]));
    else setSuggestions([]);
  };

  useEffect(load, []);
  useEffect(loadSuggestions, [resident]);

  const handleCreateFromSuggestion = async (s: CircleSuggestion) => {
    setSuggestionBusy(s.activityLabel);
    try {
      const { id } = await createCircle({ name: `${s.activityLabel} Circle`, activityLabel: s.activityLabel });
      setSuggestions((rows) => rows.filter((r) => r.activityLabel !== s.activityLabel));
      load();
      navigate(`/circles/${id}`);
    } finally {
      setSuggestionBusy(null);
    }
  };

  const handleJoin = async (id: string) => {
    await joinCircle(id);
    setJoinedIds((s) => new Set(s).add(id));
    load();
  };

  const handleLeave = async (id: string) => {
    await leaveCircle(id);
    setJoinedIds((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    load();
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      await createCircle(form);
      setForm({ name: "", activityLabel: "", area: "", county: "" });
      load();
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px 80px" }}>
        <PageTitle>Circles</PageTitle>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 28px" }}>
          Recurring groups built around the things people actually do together.
        </p>

        {suggestions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
            {suggestions.map((s) => (
              <div
                key={s.activityLabel}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
                  background: colors.greenBg, border: `1px solid ${colors.green}`, borderRadius: 16, padding: "16px 20px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <UsersIcon size={18} style={{ color: colors.greenText, flex: "none" }} />
                  <span style={{ fontSize: 14.5, color: colors.text }}>
                    You've played <strong>{s.activityLabel}</strong> with the same {s.familiarCount} people more than once. Make it a Circle?
                  </span>
                </div>
                <Button onClick={() => handleCreateFromSuggestion(s)} disabled={suggestionBusy === s.activityLabel}>
                  {suggestionBusy === s.activityLabel ? "Creating…" : `Create ${s.activityLabel} Circle`}
                </Button>
              </div>
            ))}
          </div>
        )}

        {resident && (
          <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", marginBottom: 28 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Start a circle</div>
            <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={labelStyle}>Name</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Clontarf Badminton Circle" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Activity</label>
                <input value={form.activityLabel} onChange={(e) => setForm((f) => ({ ...f, activityLabel: e.target.value }))} placeholder="e.g. Badminton" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Area</label>
                <input value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>County</label>
                <input value={form.county} onChange={(e) => setForm((f) => ({ ...f, county: e.target.value }))} style={inputStyle} />
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <Button onClick={handleCreate} disabled={creating || !form.name.trim()}>
                {creating ? "Creating…" : "Create circle"}
              </Button>
            </div>
          </div>
        )}

        {circles.length === 0 ? (
          <EmptyState icon={<UsersIcon size={20} />} title="No circles yet" subtitle={resident ? "Start one above." : "Sign in from My Life to start one."} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
            {circles.map((c) => (
              <Card key={c.id}>
                <button
                  onClick={() => navigate(`/circles/${c.id}`)}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontFamily: fonts.display, fontWeight: 700, fontSize: 17, marginBottom: 4, color: colors.text, display: "block" }}
                >
                  {c.name}
                </button>
                <div style={{ color: colors.mutedLight, fontSize: 13.5, marginBottom: 10 }}>
                  {[c.activityLabel, c.area, c.county].filter(Boolean).join(" · ") || "General"}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: colors.muted, display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <UsersIcon size={13} /> {c.members} member{c.members === 1 ? "" : "s"}
                  </span>
                  {resident && (
                    joinedIds.has(c.id) ? (
                      <Button variant="ghost" onClick={() => handleLeave(c.id)}>Leave</Button>
                    ) : (
                      <Button variant="ghost" onClick={() => handleJoin(c.id)}>Join</Button>
                    )
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
