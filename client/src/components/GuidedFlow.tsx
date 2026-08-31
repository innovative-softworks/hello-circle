import type { ReactNode } from "react";
import { Stepper } from "./Stepper";
import { Button } from "./ui";
import { colors, fonts, radius } from "../theme";

// Guided Flow shell (Form System Audit, Phase 5) — the container every
// multi-step creation wizard uses: existing Stepper for progress, one step's
// fields at a time, and a predictable Back / Save & continue (or Publish on
// the last step) footer. Draft persistence itself is the caller's job (see
// VendorCentreCreatePage.tsx) — this component only ever renders whatever
// step it's told to.

export function GuidedFlow({
  title,
  subtitle,
  stepLabels,
  currentStep,
  accent = "green",
  onBack,
  onContinue,
  continueLabel = "Save & continue →",
  continueDisabled,
  continueBusy,
  showBack = true,
  error,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  stepLabels: string[];
  /** 1-based, matches Stepper's own convention. */
  currentStep: number;
  accent?: "green" | "orange";
  onBack: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  continueBusy?: boolean;
  /** false on step 1, where "Back" means leaving the wizard entirely —
   * callers render their own exit link/guard instead. */
  showBack?: boolean;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <Stepper labels={stepLabels} current={currentStep} accent={accent} />
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: accent === "orange" ? colors.orangeDark : colors.greenText, marginBottom: 6 }}>
          {String(currentStep).padStart(2, "0")} / {stepLabels[currentStep - 1]?.toUpperCase()}
        </div>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 26, margin: "0 0 6px", letterSpacing: "-.01em" }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 14, color: colors.mutedLight, margin: "0 0 22px", maxWidth: 520, lineHeight: 1.5 }}>{subtitle}</p>}
      </div>

      <div style={{ marginBottom: 24 }}>{children}</div>

      {error && (
        <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: "0 0 14px", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, paddingTop: 18, borderTop: `1px solid ${colors.border}` }}>
        {showBack && (
          <Button variant="ghost" onClick={onBack} disabled={continueBusy}>
            ← Back
          </Button>
        )}
        <Button onClick={onContinue} disabled={continueDisabled || continueBusy} variant={accent === "orange" ? "orange" : "primary"}>
          {continueBusy ? "Saving…" : continueLabel}
        </Button>
      </div>
    </div>
  );
}
