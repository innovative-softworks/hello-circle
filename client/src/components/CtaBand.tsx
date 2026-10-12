import type { MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import "./ctaBand.css";

// CtaBand — the closing call-to-action band used across the app (same design
// as Home's closing band, 2026-10-12): forest background, a vertical label,
// a three-line staggered orange statement, a short line of copy and one
// pill button with an arrow. Every page passes its own copy and a real
// route; `children` sits under the button (e.g. Circles' interest form).
export function CtaBand({
  id,
  label = "Together.",
  lines,
  text,
  action,
  secondary,
  children,
}: {
  /** Unique id for the heading (aria-labelledby). */
  id: string;
  label?: string;
  /** The statement, one entry per staggered line (keep each short). */
  lines: [string, string, string];
  text: ReactNode;
  /** `onClick` replaces navigation when the action needs a check first
   * (e.g. sign-in before starting a game); `to` is still the link target. */
  action: { label: string; to: string; onClick?: () => void };
  /** Optional quieter text link under the button. */
  secondary?: { label: string; to: string };
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  const go = (to: string, onClick?: () => void) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onClick && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return;
    e.preventDefault();
    if (onClick) onClick();
    else navigate(to);
  };
  return (
    <section className="cta-band" aria-labelledby={id} data-no-reveal>
      <div className="cta-band-grid">
        <span className="cta-band-vert" aria-hidden="true">
          {label}
        </span>
        <h2 id={id} className="cta-band-title">
          <span>{lines[0]}</span> <span>{lines[1]}</span> <span>{lines[2]}</span>
        </h2>
        <div className="cta-band-side">
          <p>{text}</p>
          <a className="cta-band-btn" href={action.to} onClick={go(action.to, action.onClick)}>
            {action.label} <ArrowRight size={16} aria-hidden="true" />
          </a>
          {secondary && (
            <a className="cta-band-link" href={secondary.to} onClick={go(secondary.to)}>
              {secondary.label} <ArrowRight size={14} aria-hidden="true" />
            </a>
          )}
          {children ? <div className="cta-band-panel">{children}</div> : null}
        </div>
      </div>
    </section>
  );
}
