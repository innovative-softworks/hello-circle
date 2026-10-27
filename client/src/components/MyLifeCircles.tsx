import { useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "./ui";
import { dateLabel } from "../euro";
import { colors, fonts } from "../theme";
import type { Circle } from "../types";

// My Life IA redesign §8 — editorial rows, not a card grid: each Circle
// answers "what's happening next?" first, membership count demoted to
// small metadata. Shows 3 rows first (the brief's own "2-3 rows"); PUB-08 —
// when there are more, "Show all N" expands the rest in place, so the list
// always agrees with My Life's "N Circles active" count (there's no
// separate "my Circles" page to link to).
//
// PUB-08 — "NEXT" is only a plan that belongs to this Circle
// (nextPlan.source === "circle"), the same rule as CircleDiscoveryCard /
// CircleContextualCta. A "nearby" plan is another public activity that only
// shares the activity label; it used to be shown here as the Circle's next
// plan.

export function MyLifeCircles({ circles }: { circles: Circle[] }) {
  const [showAll, setShowAll] = useState(false);
  if (circles.length === 0) return null;
  const visible = showAll ? circles : circles.slice(0, 3);

  return (
    <div>
      {visible.map((c, i) => {
        const plan = c.nextPlan && c.nextPlan.source === "circle" ? c.nextPlan : null;
        return (
        // PUB-31 — the row used to be a <button> with the organiser's "Manage"
        // <button> nested inside it (invalid HTML, unpredictable keyboard and
        // click behaviour). Now the standard stretched-link row (index.css):
        // one real link to the Circle covering the row, and "Manage" its own
        // separate link painted above it. Same look as before.
        <div
          key={c.id}
          style={{
            position: "relative", display: "flex", alignItems: "center", gap: 16, width: "100%", textAlign: "left",
            padding: "18px 0", borderTop: i === 0 ? "none" : `1px solid ${colors.border}`,
          }}
        >
          <Link to={`/circles/${c.slug ?? c.id}`} className="stretched-link" aria-label={c.name} />
          <Avatar name={c.name} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {c.name}
            </div>
            <div style={{ fontSize: 12.5, color: colors.faint, display: "flex", alignItems: "center", gap: 8 }}>
              <span>{c.myRole === "organiser" ? "Organiser" : "Member"} · {c.members} member{c.members === 1 ? "" : "s"}</span>
              {/* Manage Circle (Follow/Notify/Stats gap audit) — previously
                  only reachable via the account-menu workspace switcher,
                  easy to miss entirely. An organiser already sees their role
                  right here, so the direct link belongs next to it. */}
              {c.myRole === "organiser" && (
                <Link
                  to={`/manage/circles/${c.slug ?? c.id}`}
                  className="stretched-link-above"
                  aria-label={`Manage ${c.name}`}
                  style={{ color: colors.greenText, fontWeight: 700, fontSize: 12.5, textDecoration: "underline" }}
                >
                  Manage
                </Link>
              )}
            </div>
          </div>
          <div style={{ flex: "none", textAlign: "right", maxWidth: 140 }}>
            {c.activePlan ? (
              // Phase 2 "Circles V2" — an explicit plan-idea (real
              // circle_id relationship) takes priority over the fuzzy
              // nextPlan match below when both exist.
              <>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0, color: colors.mutedLight, marginBottom: 2 }}>PLANNING</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.activePlan.title}</div>
              </>
            ) : plan ? (
              <>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0, color: colors.mutedLight, marginBottom: 2 }}>NEXT</div>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{dateLabel(plan.date)} · {plan.time}</div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: colors.faint }}>Nothing planned yet</div>
            )}
          </div>
        </div>
        );
      })}
      {circles.length > 3 && (
        <button
          type="button"
          className="btn-reset"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          style={{ marginTop: 6, padding: "8px 0", fontSize: 13, fontWeight: 700, color: colors.text, textDecoration: "underline" }}
        >
          {showAll ? "Show fewer" : `Show all ${circles.length} Circles`}
        </button>
      )}
    </div>
  );
}
