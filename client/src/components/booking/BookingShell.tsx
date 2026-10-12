import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { bk, bkFonts, bkRadius, bookingSurfaceCss } from "./bookingTheme";

// Booking kit — layout. BookingSurface scopes the kit's tokens; BookingShell
// is the step page (progress, title, content, summary rail on desktop /
// fixed submit bar on phones). UX plan §3.2.

const CSS = bookingSurfaceCss();

export function BookingSurface({ children, scheme, page, style }: { children: ReactNode; /** Force a scheme (kit preview only). */ scheme?: "light" | "dark"; /** A whole page: the booking ground runs to the bottom of the viewport. */ page?: boolean; style?: CSSProperties }) {
  return (
    <div data-surface="booking" data-scheme={scheme} style={{ minHeight: page ? "100vh" : undefined, ...style }}>
      <style>{CSS}</style>
      {children}
    </div>
  );
}

const srOnly: CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 };

/** Segmented progress: done steps ink, the current one orange-red. Labels
 * show from tablet width up; phones get "Step n of N · Label". */
export function StepProgress({ labels, current }: { labels: string[]; current: number }) {
  return (
    <nav aria-label="Booking progress">
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0, textTransform: "uppercase", color: bk.muted, marginBottom: 8 }}>
        Step {current} of {labels.length} · {labels[current - 1]}
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))`, gap: 4 }}>
        {labels.map((label, i) => {
          const n = i + 1;
          const state = n < current ? "done" : n === current ? "current" : "todo";
          return (
            <li key={label} aria-current={state === "current" ? "step" : undefined}>
              <div aria-hidden="true" style={{ height: 3, background: state === "current" ? bk.accent : state === "done" ? bk.ink : bk.lineStrong }} />
              <span style={srOnly}>
                {label}
                {state === "done" ? " (completed)" : state === "current" ? " (current step)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export type BkButtonVariant = "primary" | "secondary" | "dark" | "quiet" | "danger";

/** The kit's buttons: 44px minimum targets, a busy state that announces
 * itself, and a primary fill whose label stays ink (AA on #FF4B24). */
export function BkButton({
  variant = "primary",
  children,
  onClick,
  disabled,
  busy,
  busyLabel,
  type = "button",
  full,
  ariaLabel,
  style,
}: {
  variant?: BkButtonVariant;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  type?: "button" | "submit";
  full?: boolean;
  ariaLabel?: string;
  style?: CSSProperties;
}) {
  const inactive = disabled || busy;
  const look: Record<BkButtonVariant, CSSProperties> = {
    primary: { background: bk.accent, color: bk.onAccent, border: "none", fontFamily: bkFonts.display, fontSize: 18, fontWeight: 700, minHeight: 54, padding: "0 26px" },
    secondary: { background: "transparent", color: bk.ink, border: `1px solid ${bk.ink}`, fontSize: 16, fontWeight: 600, minHeight: 48, padding: "0 20px" },
    dark: { background: bk.ink, color: bk.bg, border: "none", fontSize: 16, fontWeight: 600, minHeight: 48, padding: "0 20px" },
    quiet: { background: "none", color: bk.accentText, border: "none", fontSize: 15, fontWeight: 600, minHeight: 44, padding: 0 },
    danger: { background: "none", color: bk.danger, border: "none", fontSize: 15, fontWeight: 600, minHeight: 44, padding: "0 4px", textDecoration: "underline" },
  };
  const disabledLook: CSSProperties = variant === "quiet" || variant === "danger" ? { opacity: 0.55 } : { background: bk.disabledBg, color: bk.disabledInk, border: "none" };
  return (
    <button
      type={type}
      onClick={inactive ? undefined : onClick}
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
      style={{
        borderRadius: bkRadius.control,
        cursor: inactive ? "default" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        width: full ? "100%" : undefined,
        ...look[variant],
        ...(disabled ? disabledLook : null),
        ...style,
      }}
    >
      {busy && (
        <svg className="bk-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-6.2-8.6" />
        </svg>
      )}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

/** Errors for the whole step, focused when shown so screen readers hear them. */
export function StepErrors({ errors }: { errors: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const signature = errors.join("\n");
  // Focus only when the set of errors changes — never while someone types.
  useEffect(() => {
    if (signature) ref.current?.focus();
  }, [signature]);
  if (errors.length === 0) return null;
  return (
    <div role="alert" tabIndex={-1} ref={ref} style={{ border: `2px solid ${bk.danger}`, background: bk.dangerBg, borderRadius: bkRadius.card, padding: "14px 16px", color: bk.ink }}>
      <div style={{ fontWeight: 700, marginBottom: errors.length > 1 ? 6 : 0 }}>{errors.length === 1 ? errors[0] : "Please fix these before continuing:"}</div>
      {errors.length > 1 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One booking step. `summary` sits in a sticky rail from 900px up and below
 * the content on phones; `submitBar` is fixed to the bottom on phones. */
export function BookingShell({
  steps,
  current,
  title,
  onBack,
  backLabel = "Back",
  errors = [],
  summary,
  submitBar,
  children,
}: {
  steps: string[];
  current: number;
  title: string;
  onBack?: () => void;
  backLabel?: string;
  errors?: string[];
  summary?: ReactNode;
  submitBar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bk-shell">
      <main className="bk-main">
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={backLabel}
              style={{ width: 44, height: 44, flex: "none", border: `1px solid ${bk.lineStrong}`, background: "transparent", borderRadius: bkRadius.control, display: "flex", alignItems: "center", justifyContent: "center", color: bk.ink, cursor: "pointer" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <StepProgress labels={steps} current={current} />
          </div>
        </div>
        <h1 style={{ margin: 0, fontFamily: bkFonts.display, fontSize: "clamp(32px, 3.8vw, 52px)", lineHeight: 1.04, fontWeight: 700, letterSpacing: 0 }}>{title}</h1>
        <StepErrors errors={errors} />
        {children}
        {submitBar}
      </main>
      {summary && (
        <aside className="bk-rail" aria-label="Booking summary">
          {summary}
        </aside>
      )}
    </div>
  );
}

/** The step's primary action. On phones it's fixed above the tab bar with
 * the total echoed; from 900px it sits inline at the end of the step. */
export function SubmitBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="bk-submitbar" data-bottom-chrome>
      <div className="bk-submitbar-inner">
        {children}
        {note && <div style={{ fontSize: 13, color: bk.muted, textAlign: "center" }}>{note}</div>}
      </div>
    </div>
  );
}

/** "We hold this for N minutes while you pay" — matches the server's
 * PENDING_HOLD_MINUTES; display only, it never extends anything. */
export function HoldNotice({ minutes = 30, what = "slot" }: { minutes?: number; what?: string }) {
  return <>We hold this {what} for {minutes} minutes while you pay.</>;
}
