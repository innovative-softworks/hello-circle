import type { ReactNode, RefObject } from "react";
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
  continueType = "button",
  showBack = true,
  error,
  errorId,
  errorRef,
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
  /** "submit" (auth UX repair) makes the Continue button a real form submit
   * control instead of a plain onClick target — the caller is then
   * responsible for wrapping its `children` (plus this component) in its own
   * `<form onSubmit>` that calls `onContinue` itself, so Enter-in-a-field and
   * clicking Continue both funnel through the same single code path. Left
   * as "button" (unchanged, onClick={onContinue}) for every existing caller
   * that hasn't opted in, so this is purely additive. */
  continueType?: "button" | "submit";
  /** false on step 1, where "Back" means leaving the wizard entirely —
   * callers render their own exit link/guard instead. */
  showBack?: boolean;
  error?: string | null;
  /** Lets a field elsewhere in `children` point its aria-describedby at this
   * error banner. */
  errorId?: string;
  /** Moves focus onto the error banner the moment it appears — pass the
   * result of AuthForms.tsx's useFocusOnError(error). */
  errorRef?: RefObject<HTMLParagraphElement>;
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
        <p id={errorId} ref={errorRef} tabIndex={-1} role="alert" style={{ color: colors.danger, fontSize: 13, margin: "0 0 14px", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control, outline: "none" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, paddingTop: 18, borderTop: `1px solid ${colors.border}` }}>
        {showBack && (
          <Button type="button" variant="ghost" onClick={onBack} disabled={continueBusy}>
            ← Back
          </Button>
        )}
        <Button
          type={continueType}
          onClick={continueType === "submit" ? undefined : onContinue}
          disabled={continueDisabled || continueBusy}
          variant={accent === "orange" ? "orange" : "primary"}
        >
          {continueBusy ? "Saving…" : continueLabel}
        </Button>
      </div>
    </div>
  );
}
