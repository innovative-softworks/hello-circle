import { useState } from "react";
import { cancelIntent } from "../api";
import { colors, fonts } from "../theme";
import type { MyIntent } from "../types";

// "Things you're waiting for" (My Life redesign §29/§30) — real, active
// participation intents (the app's own demand-capture system), not
// invented matches. A "matched" intent shows a lighter confirmation state
// than an "active" one still waiting for a match.

const STATUS_LABEL: Record<MyIntent["status"], string> = {
  active: "Looking for matches",
  matched: "Match found",
  converted: "Joined",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function MyLifeWaitingFor({ intents, onChange }: { intents: MyIntent[]; onChange: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const active = intents.filter((i) => i.status === "active" || i.status === "matched");
  if (active.length === 0) return null;

  const handleRemove = async (id: string) => {
    setBusyId(id);
    try {
      await cancelIntent(id);
      onChange();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {active.map((i) => (
        <div key={i.id} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15 }}>{i.activityLabel}</div>
            <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>
              {[i.preferredTimeWindow, i.county].filter(Boolean).join(" · ")}
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: i.status === "matched" ? colors.greenText : colors.orangeDark, textTransform: "uppercase", letterSpacing: ".04em", marginTop: 6 }}>
              {STATUS_LABEL[i.status]}
            </div>
            {i.status === "active" && (
              <div style={{ fontSize: 12, color: colors.faint, marginTop: 3 }}>We'll let you know when something suitable appears.</div>
            )}
          </div>
          <button
            onClick={() => handleRemove(i.id)}
            disabled={busyId === i.id}
            style={{ background: "none", border: `1px solid ${colors.borderStrong}`, borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, color: colors.text, cursor: "pointer" }}
          >
            {busyId === i.id ? "…" : "Remove"}
          </button>
        </div>
      ))}
    </div>
  );
}
