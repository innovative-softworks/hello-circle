import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchVendorSetupStatus } from "../api";
import type { VendorSetupStatus, VendorSetupStep } from "../api";
import { CheckIcon } from "./icons";
import { Button } from "./ui";
import { colors, fonts, radius } from "../theme";

// Business setup status (onboarding audit G2). Everything shown is derived
// server-side from saved state (GET /auth/setup-status) — no local flags — and
// it works for a *pending* vendor, who otherwise sees nothing but "Awaiting
// approval" because every other vendor route is gated on approval.
//
// Two placements: `pending` (the awaiting-approval screen: what was submitted
// and what happens next) and `approved` (the dashboard overview: a "finish
// setting up" card that disappears once every step is done).

function StepRow({ step, muted }: { step: VendorSetupStep; muted?: boolean }) {
  return (
    <li style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", opacity: muted && !step.done ? 0.75 : 1 }}>
      <span
        aria-hidden="true"
        style={{ width: 20, height: 20, borderRadius: "50%", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", background: step.done ? colors.greenBg : "transparent", border: `1.5px solid ${step.done ? colors.green : colors.borderStrong}`, color: colors.greenText }}
      >
        {step.done && <CheckIcon size={12} />}
      </span>
      <span style={{ fontSize: 14, color: step.done ? colors.text : colors.textSoft, fontWeight: step.done ? 600 : 500 }}>
        {step.label}
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{step.done ? " — done" : " — not done yet"}</span>
      </span>
    </li>
  );
}

export function VendorSetupChecklist({ variant }: { variant: "pending" | "approved" }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<VendorSetupStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchVendorSetupStatus().then(setStatus).catch(() => setFailed(true));
  }, []);

  if (failed || !status) return null;
  if (variant === "approved" && status.complete) return null;

  const submitted = status.steps.filter((s) => s.phase === "submitted");
  const review = status.steps.filter((s) => s.phase === "review");
  const after = status.steps.filter((s) => s.phase === "after_approval");
  const editPath = status.listing ? `/vendor/${status.listing.type === "centre" ? "centres" : "clubs"}/${status.listing.id}` : null;

  if (variant === "pending") {
    return (
      <div style={{ textAlign: "left", marginTop: 22, borderTop: `1px solid ${colors.border}`, paddingTop: 18 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, marginBottom: 4 }}>What you've submitted</div>
        <ul style={{ listStyle: "none", margin: "0 0 14px", padding: 0 }}>
          {[...submitted, ...review].map((s) => <StepRow key={s.key} step={s} />)}
        </ul>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, marginBottom: 2 }}>Once you're approved</div>
        <p style={{ margin: "0 0 4px", fontSize: 12.5, color: colors.mutedLight }}>You can finish these from your dashboard — you can't edit your listing until then.</p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {after.map((s) => <StepRow key={s.key} step={s} muted />)}
        </ul>
      </div>
    );
  }

  const remaining = after.filter((s) => !s.done);
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16 }}>Finish setting up your listing</div>
        {editPath && <Button onClick={() => navigate(editPath)}>{remaining.length ? "Continue setup" : "Open listing"}</Button>}
      </div>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: colors.mutedLight }}>
        {remaining.length} {remaining.length === 1 ? "step" : "steps"} left before your listing is fully set up.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {[...submitted, ...review, ...after].map((s) => <StepRow key={s.key} step={s} />)}
      </ul>
    </div>
  );
}
