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

/** What the partner can do about a step, or null when it's HelloCircle's move. */
function nextAction(step: VendorSetupStep, editPath: string | null): { label: string; to: string } | null {
  switch (step.key) {
    case "details":
      return { label: "Add business details", to: "/vendor?tab=org" };
    case "listing":
    case "first_listing":
      return { label: "Create a listing", to: "/vendor?tab=listings" };
    case "photo":
      return editPath ? { label: "Add a cover photo", to: editPath } : null;
    case "capacity":
      return editPath ? { label: "Set room capacity", to: editPath } : null;
    case "club_details":
      return editPath ? { label: "Add sport and ages", to: editPath } : null;
    case "submitted":
      return editPath ? { label: "Review and submit", to: editPath } : null;
    default:
      return null; // terms (handled by the sign-in gate), account review, listing review
  }
}

const WAITING: Record<string, string> = {
  review: "HelloCircle is reviewing your partner account. You'll get an email when it's approved.",
  live: "Your listing is with HelloCircle for review. It goes live once it's approved.",
  terms: "Accept the Terms when you're next asked to continue.",
};

export function VendorSetupChecklist({ variant }: { variant: "pending" | "approved" }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<VendorSetupStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    fetchVendorSetupStatus()
      .then(setStatus)
      .catch(() => setFailed(true));
  };
  useEffect(load, []);

  if (failed) {
    return (
      <p role="alert" style={{ fontSize: 13.5, margin: "0 0 16px" }}>
        Couldn't load your setup progress.{" "}
        <button type="button" className="btn-reset" onClick={load} style={{ textDecoration: "underline", fontWeight: 600 }}>
          Try again
        </button>
      </p>
    );
  }
  if (!status) return null;
  if (variant === "approved" && status.complete) return null;

  const submitted = status.steps.filter((s) => s.phase === "submitted");
  const review = status.steps.filter((s) => s.phase === "review");
  const after = status.steps.filter((s) => s.phase === "after_approval");
  const editPath = status.listing ? `/vendor/${status.listing.type === "centre" ? "centres" : "clubs"}/${status.listing.id}` : null;

  if (variant === "pending") {
    return (
      <div style={{ textAlign: "left", marginTop: 22, borderTop: `1px solid ${colors.border}`, paddingTop: 18 }}>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>What you've submitted</h2>
        <ul style={{ listStyle: "none", margin: "0 0 14px", padding: 0 }}>
          {[...submitted, ...review].map((s) => <StepRow key={s.key} step={s} />)}
        </ul>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 2px" }}>Once your account is approved</h2>
        <p style={{ margin: "0 0 4px", fontSize: 12.5, color: colors.mutedLight }}>You can finish these from your workspace — you can't edit your listing until then.</p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {after.map((s) => <StepRow key={s.key} step={s} muted />)}
        </ul>
      </div>
    );
  }

  const all = [...submitted, ...review, ...after];
  const done = all.filter((s) => s.done).length;
  const next = all.find((s) => !s.done) ?? null;
  const action = next ? nextAction(next, editPath) : null;
  return (
    <section aria-labelledby="setup-next" style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: colors.mutedLight }}>
            Setup · {done} of {all.length} done
          </p>
          <h2 id="setup-next" style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "2px 0 0" }}>
            Next: {next?.label}
          </h2>
          {next && !action && WAITING[next.key] && <p style={{ margin: "4px 0 0", fontSize: 13.5, color: colors.mutedLight }}>{WAITING[next.key]}</p>}
        </div>
        {action && <Button onClick={() => navigate(action.to)}>{action.label}</Button>}
      </div>
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}>Show all setup steps</summary>
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
          {all.map((s) => <StepRow key={s.key} step={s} />)}
        </ul>
      </details>
    </section>
  );
}
