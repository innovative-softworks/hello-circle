import type { CSSProperties, ReactNode } from "react";
import { fonts } from "../theme";

// UI/UX plan phase 3 — the audit's own grep found 21 different font sizes
// used for a page's own <h1> across client/src/pages, each hand-picked
// independently. Two real roles cover what this app actually needs: a
// top-level page identity ("Games", "Circles", "Free Time Mode") and an
// entity-detail title (a specific game/circle/centre's own name, shown one
// level down). `type.hero`/`type.section` from theme.ts's scale map to
// those two roles respectively — this component is the only place that
// scale gets applied, so it can't drift page by page again.

export function PageTitle({
  children,
  level = "hero",
  style,
}: {
  children: ReactNode;
  level?: "hero" | "section";
  style?: CSSProperties;
}) {
  // Design-system consistency pass: one responsive heading scale shared by
  // every page title (matches the hand-written page <h1>s).
  const fontSize = level === "hero" ? "clamp(32px, 3.8vw, 52px)" : "clamp(24px, 2.4vw, 30px)";
  return (
    <h1
      style={{
        fontFamily: fonts.display,
        fontWeight: 800,
        fontSize,
        lineHeight: 1.02,
        margin: "0 0 8px",
        letterSpacing: 0,
        ...style,
      }}
    >
      {children}
    </h1>
  );
}
