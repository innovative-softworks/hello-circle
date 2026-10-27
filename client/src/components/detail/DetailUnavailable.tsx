import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, inputStyle } from "../ui";
import { colors, fonts } from "../../theme";

// Detail-page audit DP-33/DP-42 (2026-10-22) — a removed, never-published or
// missing listing used to be a dead end with one link (and "no longer
// available" even for something that was never public). Now: a neutral line,
// a search box and the list, so an old or shared link still leads somewhere.

export function DetailUnavailable({ noun, listPath, listLabel }: { noun: string; listPath: string; listLabel: string }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  return (
    <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px, 2.4vw, 30px)", margin: "0 0 10px" }}>This {noun} isn't available.</h1>
      <p style={{ color: colors.mutedLight, margin: "0 0 20px", lineHeight: 1.5 }}>It may have ended, been removed, or not be open to the public yet.</p>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(q.trim() ? `/explore?q=${encodeURIComponent(q.trim())}` : "/explore");
        }}
        style={{ display: "flex", gap: 8, marginBottom: 14 }}
      >
        <input aria-label="Search for something similar" placeholder="Search activities, circles or places…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        <Button type="submit">Search</Button>
      </form>
      <Button variant="ghost" onClick={() => navigate(listPath)}>{listLabel}</Button>
    </section>
  );
}
