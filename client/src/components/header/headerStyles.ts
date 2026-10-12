import type { CSSProperties } from "react";
import { colors, fonts, radius } from "../../theme";

// Layout-only styles for the header menus. Hover / focus / active states are
// in header.css (inline styles would override them).

export const badgeStyle: CSSProperties = {
  position: "absolute",
  top: -4,
  right: -4,
  background: colors.orange,
  color: "#fff",
  borderRadius: radius.pill,
  fontSize: 10,
  fontWeight: 700,
  minWidth: 17,
  height: 17,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 4px",
  lineHeight: 1,
};

export const inlineCountStyle: CSSProperties = {
  marginLeft: "auto",
  background: colors.orange,
  color: "#fff",
  borderRadius: radius.pill,
  fontSize: 11,
  fontWeight: 700,
  padding: "1px 7px",
  flex: "none",
};

export const panelStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  zIndex: 60,
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  boxShadow: "0 12px 28px rgba(23,32,25,.12)",
  padding: 8,
};

export const menuLabelStyle: CSSProperties = {
  padding: "10px 12px 4px",
  fontSize: 11.5,
  fontWeight: 700,
  color: colors.muted,
  textTransform: "uppercase",
  letterSpacing: 0,
};

export const menuRowTitleStyle: CSSProperties = { display: "block", fontFamily: fonts.display, fontSize: 15, fontWeight: 700, color: colors.text, letterSpacing: 0 };
export const menuRowDescStyle: CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 400, color: colors.muted, marginTop: 2, lineHeight: 1.4 };
export const dividerStyle: CSSProperties = { borderTop: `1px solid ${colors.border}`, margin: "6px 4px" };
export const iconCellStyle: CSSProperties = { display: "inline-flex", flex: "none", color: colors.text };

/** Lucide stroke width for the whole navigation system (brief: 1.8–2). */
export const ICON_STROKE = 1.9;

export const countLabel = (n: number) => (n > 99 ? "99+" : String(n));
