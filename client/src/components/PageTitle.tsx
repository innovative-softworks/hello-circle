import type { CSSProperties, ReactNode } from "react";
import { fonts, type } from "../theme";

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
  const scale = level === "hero" ? type.hero : type.section;
  return (
    <h1
      style={{
        fontFamily: fonts.display,
        fontWeight: scale.weight,
        fontSize: scale.size,
        margin: "0 0 8px",
        letterSpacing: "-.02em",
        ...style,
      }}
    >
      {children}
    </h1>
  );
}
