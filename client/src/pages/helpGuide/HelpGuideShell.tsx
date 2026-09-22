import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon } from "../../components/icons";
import { GUIDE_SECTIONS } from "../../components/helpGuide/sections";
import { colors, fonts } from "../../theme";

// Same standalone-content-page shell PrivacyPolicy.tsx/CookiePolicy.tsx
// already use (back button, plain h1, colors.faint meta line) — wider
// (860 vs 760) since step content + screenshot placeholders need more
// room than policy prose.
export function HelpGuideShell({
  slug,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  /** Omit on the index page itself — suppresses the prev/next footer. */
  slug?: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const index = slug ? GUIDE_SECTIONS.findIndex((s) => s.slug === slug) : -1;
  const prev = index > 0 ? GUIDE_SECTIONS[index - 1] : null;
  const next = index >= 0 && index < GUIDE_SECTIONS.length - 1 ? GUIDE_SECTIONS[index + 1] : null;

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 860, margin: "0 auto", padding: "36px 24px 90px" }}>
        <button
          onClick={() => (slug ? navigate("/help-guide") : navigate(-1))}
          style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", color: colors.muted, fontWeight: 600, fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 20 }}
        >
          <ChevronLeftIcon size={14} style={{ marginRight: 4 }} /> {slug ? "All guide sections" : "Back"}
        </button>

        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 10 }}>
          <span style={{ color: colors.orange }}>/</span> {eyebrow}
        </div>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(28px, 5vw, 40px)", margin: "0 0 12px", letterSpacing: "-.02em" }}>
          {title}
        </h1>
        <p style={{ color: colors.mutedLight, fontSize: 16, lineHeight: 1.6, margin: "0 0 36px", maxWidth: 640 }}>{subtitle}</p>

        {children}

        {slug && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", marginTop: 48, paddingTop: 28, borderTop: `1px solid ${colors.border}` }}>
            {prev ? (
              <button
                onClick={() => navigate(`/help-guide/${prev.slug}`)}
                style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 18px", cursor: "pointer", textAlign: "left" }}
              >
                <ChevronLeftIcon size={14} style={{ color: colors.muted, flex: "none" }} />
                <span>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.mutedLight, textTransform: "uppercase", letterSpacing: ".04em" }}>Previous</div>
                  <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14.5, color: colors.text }}>{prev.label}</div>
                </span>
              </button>
            ) : <div />}
            {next ? (
              <button
                onClick={() => navigate(`/help-guide/${next.slug}`)}
                style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 18px", cursor: "pointer", textAlign: "right" }}
              >
                <span>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.mutedLight, textTransform: "uppercase", letterSpacing: ".04em" }}>Next</div>
                  <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14.5, color: colors.text }}>{next.label}</div>
                </span>
                <ChevronRightIcon size={14} style={{ color: colors.muted, flex: "none" }} />
              </button>
            ) : <div />}
          </div>
        )}
      </section>
    </div>
  );
}
