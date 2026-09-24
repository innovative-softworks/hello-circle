import { CalendarIcon, PinIcon, TreeIconSmall } from "./icons";
import { Photo } from "./Photo";
import { Card, CardLink } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Experience } from "../types";
import { formatPrice } from "../formatters";

// Shared by the Adventures and Experiences browse pages (see
// pages/Adventures.tsx / pages/Experiences.tsx) — both kinds share one
// database table/booking model (see experiences_adventures_feature memory),
// so the card only needs a kind-based accent, not a kind-based component.
// Navigates to /adventures/:id or /experiences/:id based on the row's own
// `kind`, so it's correct regardless of which browse page (or search
// result) rendered it.

export function ExperienceCard({ e }: { e: Experience }) {
  const nextSession = e.sessions[0];
  const href = `/${e.kind === "adventure" ? "adventures" : "experiences"}/${e.slug ?? e.id}`;
  return (
    <Card hover style={{ position: "relative", padding: 0, overflow: "hidden" }}>
      <CardLink to={href} label={e.title} />
      <Photo
        src={e.imageUrl || undefined}
        alt={e.title}
        ph={e.kind === "adventure" ? colors.greenBg : colors.orangeBg}
        icon={<TreeIconSmall size={28} />}
        iconColor={e.kind === "adventure" ? colors.greenText : colors.orangeDark}
        style={{ height: 140 }}
      />
      <div style={{ padding: 15 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: 0 }}>{e.title}</h3>
          <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap" }}>{formatPrice(e.priceCents)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, color: colors.mutedLight, fontSize: 13, marginTop: 4 }}>
          <PinIcon size={12} /> {e.area}{e.area && e.county ? ", " : ""}{e.county}
        </div>
        {e.blurb && <p style={{ fontSize: 13, color: colors.muted, margin: "8px 0 0", lineHeight: 1.4 }}>{e.blurb}</p>}
        {e.difficulty && (
          <div style={{ marginTop: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: radius.pill, padding: "2px 8px", textTransform: "capitalize" }}>{e.difficulty}</span>
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
