import { useNavigate } from "react-router-dom";
import { CalendarIcon, PinIcon, TreeIconSmall } from "./icons";
import { Card } from "./ui";
import { colors, fonts } from "../theme";
import type { Experience } from "../types";

// Shared by the Adventures and Experiences browse pages (see
// pages/Adventures.tsx / pages/Experiences.tsx) — both kinds share one
// database table/booking model (see experiences_adventures_feature memory),
// so the card only needs a kind-based accent, not a kind-based component.
// Navigates to /adventures/:id or /experiences/:id based on the row's own
// `kind`, so it's correct regardless of which browse page (or search
// result) rendered it.

export function ExperienceCard({ e }: { e: Experience }) {
  const navigate = useNavigate();
  const nextSession = e.sessions[0];
  return (
    <Card hover onClick={() => navigate(`/${e.kind === "adventure" ? "adventures" : "experiences"}/${e.id}`)} style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          height: 140,
          background: e.imageUrl ? `url(${e.imageUrl}) center/cover` : e.kind === "adventure" ? colors.greenBg : colors.orangeBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!e.imageUrl && <TreeIconSmall size={28} style={{ color: e.kind === "adventure" ? colors.greenText : colors.orangeDark, opacity: 0.6 }} />}
      </div>
      <div style={{ padding: 15 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: 0 }}>{e.title}</h3>
          <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap" }}>{e.priceCents ? `€${(e.priceCents / 100).toFixed(2)}` : "Free"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, color: colors.mutedLight, fontSize: 13, marginTop: 4 }}>
          <PinIcon size={12} /> {e.area}{e.area && e.county ? ", " : ""}{e.county}
        </div>
        {e.blurb && <p style={{ fontSize: 13, color: colors.muted, margin: "8px 0 0", lineHeight: 1.4 }}>{e.blurb}</p>}
        {e.difficulty && (
          <div style={{ marginTop: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: 999, padding: "2px 8px", textTransform: "capitalize" }}>{e.difficulty}</span>
          </div>
        )}
        {nextSession && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, color: colors.muted, fontSize: 12.5, marginTop: 10 }}>
            <CalendarIcon size={12} /> Next: {nextSession.date} · {nextSession.time}
          </div>
        )}
      </div>
    </Card>
  );
}
