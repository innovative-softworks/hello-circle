import type { ReactNode } from "react";
import { colors, fonts } from "../../theme";

// Giant-numeral step treatment, reused from HostHowItWorks.tsx/
// ChooseYourPathSection.tsx's "01/02/03" language (see also Header.tsx's
// Explore/Start megamenus, same premium-editorial pass) — the app already
// has a numbered-step visual system, so the guide uses it instead of
// inventing a new one.
export function GuideStep({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 24, padding: "28px 0", borderTop: `1px solid ${colors.border}` }} className="stack-mobile">
      <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 40, letterSpacing: "-.02em", color: colors.borderStrong, lineHeight: 1, flex: "none", width: 56 }}>
        {n}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: "0 0 8px", letterSpacing: "-.01em" }}>{title}</h3>
        <div style={{ color: "#3B423C", fontSize: 15, lineHeight: 1.65 }}>{children}</div>
      </div>
    </div>
  );
}

export const guideStepPStyle: React.CSSProperties = { margin: "0 0 10px" };
export const guideStepUlStyle: React.CSSProperties = { margin: "0 0 10px", paddingLeft: 20 };
export const guideStepLiStyle: React.CSSProperties = { margin: "0 0 6px" };
export const guideStepNoteStyle: React.CSSProperties = {
  background: colors.greenBg,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: "10px 14px",
  fontSize: 13.5,
  color: colors.greenText,
  lineHeight: 1.5,
  margin: "10px 0",
};
