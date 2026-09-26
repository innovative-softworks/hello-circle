import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchNewHere } from "../api";
import { colors, fonts, radius } from "../theme";
import type { ForYouSection, NewHereCircle } from "../types";
import { DiscoverRow } from "./DiscoverRow";
import { UsersIcon } from "./icons";

// "New here?" (community participation upgrade, Release 5) — only for a
// resident who told us they're new to the area (Profile → "Are you new to
// the area?"); the server returns nothing for anyone else, so this renders
// nothing. Built entirely from existing inventory: easy activities,
// come-alone-friendly ones, open Circles welcoming members, volunteering,
// free things nearby, this weekend. Not a separate onboarding or app.

export function NewHereBlock({ county, wrap }: { county?: string | null; wrap: (children: React.ReactNode, key: string) => React.ReactNode }) {
  const navigate = useNavigate();
  const [data, setData] = useState<{ sections: ForYouSection[]; circles: NewHereCircle[] } | null>(null);

  useEffect(() => {
    fetchNewHere()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data || (!data.sections.length && !data.circles.length)) return null;

  return (
    <>
      {wrap(
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".09em", color: colors.muted, marginBottom: 6 }}>New here?</div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(22px, 3vw, 30px)", margin: "0 0 6px" }}>
            Welcome{county ? ` to ${county}` : ""}
          </h2>
          <p style={{ margin: "0 0 18px", color: colors.muted, fontSize: 15, maxWidth: 520 }}>Easy ways to get started — no experience or group needed.</p>
          {data.circles.length > 0 && (
            <div>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 10px" }}>Circles welcoming new members</h3>
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
                {data.circles.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => navigate(`/circles/${c.slug ?? c.id}`)}
                    style={{
                      flex: "none", textAlign: "left", minWidth: 200, background: colors.surface, border: `1px solid ${colors.border}`,
                      borderRadius: radius.card, padding: "14px 16px", cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 15, color: colors.text }}>{c.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: colors.muted, marginTop: 4 }}>
                      <UsersIcon size={12} /> {c.members} {c.members === 1 ? "member" : "members"}
                      {c.activityLabel ? ` · ${c.activityLabel}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>,
        "new-here-intro"
      )}
      {data.sections.map((s) => wrap(<DiscoverRow title={s.title} items={s.items} limit={10} />, `new-here-${s.key}`))}
    </>
  );
}
