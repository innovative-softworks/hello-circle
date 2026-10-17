import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { AdminButton } from "./admin/adminUi";
import { useInWorkspace } from "./workspace/inWorkspace";
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
  headingLevel = 2,
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
  /** HC-QA-083 — 1 when the flow IS the page (e.g. vendor signup); 2 when it sits under a page heading. */
  headingLevel?: 1 | 2;
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
  // HC-QA-052 adjacent — when the step changes (not on first render), move
  // focus to the new step's heading so keyboard and screen-reader users
  // start at the top of the new content. Previously focus stayed on the
  // (re-labelled) submit button at the bottom; in Safari, Tab from there
  // leaves the page entirely.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const previousStep = useRef(currentStep);
  const inWorkspace = useInWorkspace();
  const idBase = useId();
  useEffect(() => {
    if (previousStep.current === currentStep) return;
    previousStep.current = currentStep;
    headingRef.current?.focus({ preventScroll: false });
  }, [currentStep]);
  // Workspaces (option A, 2026-10-16): the step as a card, progress in a rail.
  if (inWorkspace) {
    const pct = Math.round(((currentStep - 1) / stepLabels.length) * 100);
    return (
      <div className="ws-editor">
        <section className="ws-sec" aria-labelledby={`${idBase}-h`}>
          <div className="ws-sec-head">
            <span className="adm-itile" aria-hidden="true" style={{ fontWeight: 700 }}>
              {currentStep}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Heading id={`${idBase}-h`} ref={headingRef} tabIndex={-1} className="ws-sec-title" style={{ outline: "none" }}>
                {title}
              </Heading>
              {subtitle && <p className="adm-note" style={{ margin: "2px 0 0" }}>{subtitle}</p>}
            </div>
          </div>
          <div className="ws-sec-body">{children}</div>
          {error && (
            <p id={errorId} ref={errorRef} tabIndex={-1} role="alert" className="ws-sec-errors" style={{ margin: "0 18px 14px", outline: "none" }}>
              {error}
            </p>
          )}
          <div className="ws-sec-foot">
            {showBack && (
              <AdminButton variant="quiet" onClick={onBack} disabled={continueBusy}>
                ← Back
              </AdminButton>
            )}
            <AdminButton type={continueType} variant="primary" onClick={continueType === "submit" ? undefined : onContinue} disabled={continueDisabled || continueBusy}>
              {continueBusy ? "Saving…" : continueLabel}
            </AdminButton>
          </div>
        </section>
        <aside className="ws-rail ws-rail--steps">
          <div className="adm-box ws-rail-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <strong>
                Step {currentStep} of {stepLabels.length}
              </strong>
              <span className="adm-note">{pct}%</span>
            </div>
            <div className="ws-meter" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </div>
            <ol className="ws-steps">
              {stepLabels.map((l, i) => {
                const n = i + 1;
                const state = n < currentStep ? "done" : n === currentStep ? "current" : "todo";
                return (
                  <li key={l} data-state={state} aria-current={state === "current" ? "step" : undefined}>
                    <span aria-hidden="true">{state === "done" ? "✓" : n}</span>
                    {l}
                  </li>
                );
              })}
            </ol>
            <p className="adm-note" style={{ margin: "12px 0 0" }}>Your progress is saved as a draft at each step.</p>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div>
      <Stepper labels={stepLabels} current={currentStep} accent={accent} />
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase", color: accent === "orange" ? colors.orangeDark : colors.greenText, marginBottom: 6 }}>
          {String(currentStep).padStart(2, "0")} / {stepLabels[currentStep - 1]?.toUpperCase()}
        </div>
        <Heading ref={headingRef} tabIndex={-1} style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 26, margin: "0 0 6px", letterSpacing: 0, outline: "none" }}>{title}</Heading>
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
