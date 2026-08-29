import type { ReactNode } from "react";
import { lc, lcFonts } from "../theme";

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  action,
  align = "left",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  align?: "left" | "center";
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 24,
        flexWrap: "wrap",
        marginBottom: 36,
        textAlign: align,
      }}
    >
      <div style={{ maxWidth: 620, margin: align === "center" ? "0 auto" : undefined }}>
        {eyebrow && (
          <div style={{ fontFamily: lcFonts.body, fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: lc.forest, marginBottom: 10 }}>
            {eyebrow}
          </div>
        )}
        <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", lineHeight: 1.12, color: lc.ink }}>{title}</h2>
        {subtitle && <p style={{ marginTop: 14, fontSize: 17, lineHeight: 1.55, color: lc.inkSoft, maxWidth: 540 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
