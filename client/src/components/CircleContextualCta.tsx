import { useNavigate } from "react-router-dom";
import { signInHref } from "../authRedirect";
import { ArrowRightIcon } from "./icons";
import { Button } from "./ui";
import { dateLabel } from "../euro";
import { formatCircleAvailability } from "../formatters";
import { colors, fonts } from "../theme";
import type { Circle } from "../types";

// Contextual mid-page CTA — a second, participation-led conversion moment
// for visitors who've just read "About our community" but aren't members
// yet. Deliberately tied to a real upcoming plan rather than a generic
// "Join this Circle" repeat of the rail card: only renders when there's an
// actual next plan to point at, and hides for members/organisers/closed
// Circles, since the rail Join card already covers those states.

export function CircleContextualCta({
  circle,
  signedOut,
  busy,
  onJoin,
}: {
  circle: Circle;
  signedOut: boolean;
  busy: boolean;
  onJoin: () => void;
}) {
  const navigate = useNavigate();
  const plan = circle.nextPlan;
  if (!plan) return null;

  return (
    <div
      style={{
        background: colors.greenBg,
        borderTop: `1px solid ${colors.border}`,
        borderBottom: `1px solid ${colors.border}`,
        borderRadius: 4,
        padding: "28px 32px",
        margin: "36px 0",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
      }}
    >
      <div style={{ flex: "1 1 240px" }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: colors.greenText, marginBottom: 8 }}>
          Next up
        </div>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(22px,2.6vw,28px)", letterSpacing: "-.01em", margin: 0 }}>
          Ready to join them?
        </h3>
      </div>

      <div style={{ flex: "0 1 200px", fontSize: 14 }}>
        <div style={{ fontWeight: 700, color: colors.text }}>{dateLabel(plan.date)} · {plan.time}</div>
        <div style={{ marginTop: 2, fontWeight: plan.spotsLeft <= 3 ? 700 : 400, color: plan.spotsLeft <= 3 ? colors.orangeDark : colors.mutedLight }}>
          {plan.joined} going · {formatCircleAvailability(plan.spotsLeft)}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 22, flex: "none" }}>
        <Button
          onClick={
            signedOut
              ? () =>
                  navigate(
                    signInHref({
                      kind: "circle",
                      title: circle.name,
                      meta: `${circle.members.toLocaleString()} member${circle.members === 1 ? "" : "s"} · ${circle.area}, ${circle.county}`,
                    })
                  )
              : onJoin
          }
          disabled={busy}
        >
          {busy ? "…" : signedOut ? "Sign in to join" : `Join ${circle.name} →`}
        </Button>
        <button
          onClick={() => navigate(`/games/${plan.id}`)}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, fontSize: 13.5, fontWeight: 700, color: colors.text, cursor: "pointer" }}
        >
          View next plan <ArrowRightIcon size={13} />
        </button>
      </div>
    </div>
  );
}
