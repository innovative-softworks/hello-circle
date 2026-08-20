import type { ReactNode } from "react";
import { ChevronLeftIcon } from "./icons";
import { colors } from "../theme";

// UI/UX plan phase 3 — the same "chevron + text" back affordance was hand-
// rolled with identical styling in at least 4 places (GameDetail.tsx/
// CircleDetail.tsx's "back to list" link, FreeTimeMode.tsx/MakeItHappen.tsx's
// step-back button) — same click-handler-plus-label shape whether it's
// navigating to a different route or stepping back one wizard step, so one
// component covers both instead of a wizard-specific abstraction.

export function BackLink({ onClick, children, marginBottom = 20 }: { onClick: () => void; children: ReactNode; marginBottom?: number }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", color: colors.muted, fontWeight: 600, fontSize: 14, cursor: "pointer", padding: 0, marginBottom }}
    >
      <ChevronLeftIcon size={14} style={{ marginRight: 4 }} /> {children}
    </button>
  );
}
