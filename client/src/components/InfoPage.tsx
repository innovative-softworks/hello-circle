import type { ReactNode } from "react";
import { colors } from "../theme";

// Small building blocks shared by the About and Contact pages (sitemap audit P1-02).

const ACCENT = "var(--color-brand)"; // the brand slash, same as Home's section eyebrows

/** "/ Label" eyebrow, the same brand-slash treatment as Home's section headers. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase", color: colors.mutedLight, marginBottom: 10 }}>
      <span style={{ color: ACCENT }} aria-hidden="true">
        /
      </span>{" "}
      {children}
    </div>
  );
}

/** One label/value row of a <dl> (company details). */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "min(34%, 170px) 1fr", gap: 12, padding: "12px 0", borderTop: `1px solid ${colors.border}` }}>
      <dt style={{ color: colors.mutedLight, fontSize: 13.5, fontWeight: 600 }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 14.5, color: colors.text, overflowWrap: "anywhere" }}>{children}</dd>
    </div>
  );
}
