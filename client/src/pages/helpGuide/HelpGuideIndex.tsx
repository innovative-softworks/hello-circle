import { useNavigate } from "react-router-dom";
import { ChevronRightIcon } from "../../components/icons";
import { GUIDE_SECTIONS } from "../../components/helpGuide/sections";
import { colors, fonts } from "../../theme";
import { HelpGuideShell } from "./HelpGuideShell";

export function HelpGuideIndex() {
  const navigate = useNavigate();
  return (
    <HelpGuideShell
      eyebrow="Help guide"
      title="How Hello Circle works."
      subtitle="A step-by-step walkthrough of every part of the top nav — what each destination is for, and exactly how to do the thing you're trying to do."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        {GUIDE_SECTIONS.map((s) => (
          <button
            key={s.slug}
            onClick={() => navigate(`/help-guide/${s.slug}`)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 10,
              textAlign: "left",
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 14,
              padding: "22px 22px 20px",
              cursor: "pointer",
            }}
          >
            <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, letterSpacing: "-.01em" }}>{s.label}</div>
            <p style={{ fontSize: 14, color: colors.mutedLight, lineHeight: 1.55, margin: 0, flex: 1 }}>{s.description}</p>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700, color: colors.greenText }}>
              Read the guide <ChevronRightIcon size={13} />
            </div>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 36, padding: "18px 20px", background: colors.greenBg, border: `1px solid ${colors.border}`, borderRadius: 14, fontSize: 13.5, color: colors.greenText, lineHeight: 1.55 }}>
        Can't find what you're after here? The <a href="/bookings?tab=help" style={{ color: "inherit", fontWeight: 700 }}>Help &amp; Support</a> FAQ covers quick
        questions (cancellations, refunds, Verified Host), or email{" "}
        <a href="mailto:support@hellocircle.ie" style={{ color: "inherit", fontWeight: 700 }}>support@hellocircle.ie</a> directly.
      </div>
    </HelpGuideShell>
  );
}
