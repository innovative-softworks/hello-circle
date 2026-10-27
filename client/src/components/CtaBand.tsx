import type { MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Bell } from "lucide-react";
import "./ctaBand.css";

// CtaBand — the closing call-to-action band used across the app. Owner's
// reference (2026-10-22, "Can't make this one?"): a forest band with a
// vertical label, a three-line editorial headline (cream / orange / cream),
// one line of copy, a documentary photo fading in from the right, and a
// cream panel on the right holding the one action. When the page passes an
// interest form as `children` it sits in the panel and the band's own
// actions become quiet text links under it; otherwise `action` is the
// panel's orange button. Every page passes its own copy and real routes.

// Default photograph: a group of friends round a beach campfire at dusk, long
// shot — Kimson Doan on Unsplash (unsplash.com/photos/AZMmUy2qL6A), free
// under the Unsplash License, served from Unsplash's CDN at responsive
// widths. Decorative (empty alt).
const unsplashCta = (w: number) => `https://images.unsplash.com/photo-1444210971048-6130cf0c46cf?w=${w}&q=72&auto=format&fit=crop`;
export const CTA_BAND_DEFAULT_IMAGE = {
  src: unsplashCta(900),
  srcSet: `${unsplashCta(520)} 520w, ${unsplashCta(900)} 900w, ${unsplashCta(1300)} 1300w`,
  alt: "",
};

export function CtaBand({
  id,
  label = "Together.",
  index = "01",
  lines,
  text,
  action,
  secondary,
  panel,
  image = CTA_BAND_DEFAULT_IMAGE,
  variant,
  children,
}: {
  /** Unique id for the heading (aria-labelledby). */
  id: string;
  /** Vertical decorative label (hidden from screen readers). */
  label?: string;
  /** The small marker above the vertical label. */
  index?: string;
  /** The statement in three parts: cream, orange, cream — shown on two lines
   * (first + orange part, then the last part). */
  lines: [string, string, string];
  text: ReactNode;
  /** `onClick` replaces navigation when the action needs a check first
   * (e.g. sign-in before starting a game); `to` is still the link target. */
  action: { label: string; to: string; onClick?: () => void };
  /** Optional quieter text link. */
  secondary?: { label: string; to: string };
  /** The cream panel's heading and line of copy. */
  panel?: { title: string; text?: ReactNode; icon?: ReactNode };
  /** Background photograph (decorative: empty alt by default). Pass null for none. */
  image?: { src: string; srcSet?: string; alt: string } | null;
  /** "form" — the cream panel with the interest form (detail pages, Circles).
   * "discovery" — no panel: one orange button and an optional text link under
   * the copy (Home, Explore, About, list pages). Defaults to "form" when there
   * are children, else "discovery". */
  variant?: "form" | "discovery";
  /** The interest form, when the page has one. */
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  const go = (to: string, onClick?: () => void) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onClick && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return;
    e.preventDefault();
    if (onClick) onClick();
    else navigate(to);
  };
  const hasForm = !!children;
  const mode = variant ?? (hasForm ? "form" : "discovery");
  const panelTitleId = `${id}-panel`;
  const link = (l: { label: string; to: string; onClick?: () => void }) => (
    <a key={l.to + l.label} className="cta-band-link" href={l.to} onClick={go(l.to, l.onClick)}>
      {l.label} <ArrowRight size={14} aria-hidden="true" />
    </a>
  );
  return (
    <section className={`cta-band cta-band--${mode}${image ? " cta-band--photo" : ""}`} aria-labelledby={id} data-no-reveal>
      {image && (
        <div className="cta-band-photo" aria-hidden={image.alt ? undefined : true}>
          <img src={image.src} srcSet={image.srcSet} sizes="(max-width: 900px) 100vw, 40vw" alt={image.alt} loading="lazy" decoding="async" />
        </div>
      )}
      <div className="cta-band-grid">
        <div className="cta-band-vert" aria-hidden="true">
          <span className="cta-band-vert-index">{index}</span>
          <span className="cta-band-vert-rule" />
          <span className="cta-band-vert-label">{label}</span>
          <span className="cta-band-vert-rule" />
        </div>
        <div className="cta-band-story">
          <h2 id={id} className="cta-band-title">
            {/* Two lines (owner, 2026-10-22): "Can't make this" / "one?" — the
                middle phrase stays orange. */}
            <span>
              {lines[0]} <em className="cta-band-accent">{lines[1]}</em>
            </span>{" "}
            <span>{lines[2]}</span>
          </h2>
          <p className="cta-band-text">{text}</p>
          {mode === "discovery" && (
            <div className="cta-band-actions">
              <a className="cta-band-btn" href={action.to} onClick={go(action.to, action.onClick)}>
                {action.label} <ArrowRight size={16} aria-hidden="true" />
              </a>
              {secondary && link(secondary)}
            </div>
          )}
        </div>
        {mode === "form" && (
        <div className="cta-band-panel" role="group" aria-labelledby={panel ? panelTitleId : undefined}>
          {panel && (
            <div className="cta-band-panel-head">
              <span className="cta-band-panel-icon" aria-hidden="true">
                {panel.icon ?? <Bell size={20} strokeWidth={2} />}
              </span>
              <div>
                <h3 id={panelTitleId} className="cta-band-panel-title">
                  {panel.title}
                </h3>
                {panel.text && <p className="cta-band-panel-text">{panel.text}</p>}
              </div>
            </div>
          )}
          {hasForm ? (
            <>
              <div className="cta-band-form">{children}</div>
              <div className="cta-band-links">
                {link(action)}
                {secondary && link(secondary)}
              </div>
            </>
          ) : (
            <>
              <a className="cta-band-btn" href={action.to} onClick={go(action.to, action.onClick)}>
                {action.label} <ArrowRight size={16} aria-hidden="true" />
              </a>
              {secondary && <div className="cta-band-links">{link(secondary)}</div>}
            </>
          )}
        </div>
        )}
      </div>
    </section>
  );
}
