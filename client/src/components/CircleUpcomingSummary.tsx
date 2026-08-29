import { useNavigate } from "react-router-dom";
import { ArrowRightIcon } from "./icons";
import { colors, fonts } from "../theme";
import type { Circle, CirclePlanPreview } from "../types";

const DAY_MS = 86400000;

function withinNextWeek(dateIso: string): boolean {
  const days = (new Date(`${dateIso}T00:00:00`).getTime() - Date.now()) / DAY_MS;
  return days >= 0 && days <= 7;
}

// Fills the empty space next to a sparse Upcoming Plans grid with an
// aggregate summary instead of leaving a blank gap — makes a thin plans
// list read as intentional rather than unfinished. Only ever built from the
// real upcoming-plans list already fetched for this page (no new data).

export function CircleUpcomingSummary({ circle, plans }: { circle: Circle; plans: CirclePlanPreview[] }) {
  const navigate = useNavigate();
  const next7 = plans.filter((p) => withinNextWeek(p.date));
  const rows = next7.length > 0 ? next7 : plans;
  const joining = rows.reduce((sum, p) => sum + p.joined, 0);
  const spotsLeft = rows.reduce((sum, p) => sum + p.spotsLeft, 0);

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 2,
        background: colors.panel,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        height: "100%",
      }}
    >
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 14 }}>
          {next7.length > 0 ? "Next 7 days" : "Coming up"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, letterSpacing: "-.01em" }}>
            {rows.length} plan{rows.length === 1 ? "" : "s"}
          </div>
          {joining > 0 && (
            <div style={{ fontSize: 14, color: colors.text }}>{joining} people joining</div>
          )}
          <div style={{ fontSize: 14, color: colors.text }}>
            {spotsLeft === 0 ? "Full up" : `${spotsLeft} place${spotsLeft === 1 ? "" : "s"} still available`}
          </div>
        </div>
      </div>
      <button
        onClick={() => navigate(`/games?activity=${encodeURIComponent(circle.activityLabel)}`)}
        style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer" }}
      >
        See full schedule <ArrowRightIcon size={13} />
      </button>
    </div>
  );
}
