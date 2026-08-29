import { ClipboardIcon, HeartIcon, LightbulbIcon, UsersIcon } from "./icons";
import { colors, fonts } from "../theme";
import type { Circle } from "../types";

// Main-content "About our community" (reference §14-15) — a four-column
// icon grid (mission / what we do / who can join / values), separated by
// spacing + vertical rules rather than four independent bordered cards, per
// the reference's own explicit instruction. Same real organiser-provided
// fields as the rail's About card (whatWeDo/whoCanJoin/values) — this isn't
// duplicate data entry, just the fuller main-content presentation of it.

type CommunityColumn = { icon: React.ReactNode; label: string; value: string };

export function CircleCommunityGrid({ circle }: { circle: Circle }) {
  const candidates: (CommunityColumn | null)[] = [
    circle.about ? { icon: <LightbulbIcon size={18} />, label: "Our mission", value: circle.about } : null,
    circle.whatWeDo ? { icon: <ClipboardIcon size={18} />, label: "What we do", value: circle.whatWeDo } : null,
    circle.whoCanJoin ? { icon: <UsersIcon size={18} />, label: "Who can join", value: circle.whoCanJoin } : null,
    circle.values ? { icon: <HeartIcon size={18} />, label: "Our values", value: circle.values } : null,
  ];
  const columns = candidates.filter((c): c is CommunityColumn => c !== null);

  if (columns.length === 0) return null;

  return (
    <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: `repeat(${columns.length},1fr)`, gap: 32 }}>
      {columns.map((c) => (
        <div key={c.label}>
          <div style={{ color: colors.greenText, marginBottom: 12 }}>{c.icon}</div>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{c.label}</div>
          <p style={{ margin: 0, fontSize: 13.5, color: colors.mutedLight, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}
