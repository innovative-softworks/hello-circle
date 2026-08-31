import type { ReactNode } from "react";
import { colors, fonts } from "../theme";

/** Shared editorial section header (Swiss/minimal design system) — a small
 * uppercase eyebrow label, a title, an optional supporting line, and an
 * optional right-aligned action. Originated on Home.tsx (still its biggest
 * consumer) but is the app-wide pattern now; reach for this instead of a
 * fresh ad hoc <h2>/<p> pair on any page. Static short eyebrow text rather
 * than sequential "01/02/03" numbering: several sections across the app are
 * conditionally rendered (resident-only, or only once data exists), so a
 * strict running count would skip/shift per visitor and read as a bug
 * rather than a design motif. */
export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  action,
  titleSize,
  titleColor,
}: {
  /** Usually a plain string; a page may pass a short ReactNode instead
   * (e.g. Home.tsx's "/ Label" accent-slash treatment) without affecting
   * every other plain-string call site elsewhere in the app. */
  eyebrow: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Override the title's font-size (CSS value) — the default suits most
   * of Home's ~12 sections; a couple of standout sections (e.g. "What are
   * you in the mood for?") want a bigger title without changing the
   * shared default everywhere else. */
  titleSize?: string;
  /** Override the title's color (CSS value) — e.g. the mood section's
   * title uses the logo mark's brand orange instead of the default text
   * color, without changing every other section's heading. */
  titleColor?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>
          {eyebrow}
        </div>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: titleSize ?? "clamp(20px, 2.4vw, 26px)", letterSpacing: "-.01em", margin: 0, color: titleColor ?? colors.text }}>
          {title}
        </h2>
        {subtitle && <p style={{ fontSize: 14, color: colors.mutedLight, margin: "6px 0 0" }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
