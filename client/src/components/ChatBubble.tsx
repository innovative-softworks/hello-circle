import type { ReactNode } from "react";
import { colors } from "../theme";

// UI/UX plan phase 3 — extracted from AskHelloCircle.tsx's own inline
// bubble markup. Note on scope, corrected from the original audit's first
// pass: ChatPanel.tsx's message rendering (Participation Chat, Phase 11)
// turned out NOT to be the same pattern on closer reading — it's a
// compact, named-sender row (multiple real participants, name + timestamp
// prominent), not a left/right bubble. That's the right shape for a group
// chat and is intentionally different, not an inconsistency to fix; this
// component only covers the actual bubble pattern (currently one real
// consumer, ready for a second without re-deriving the styling).

export function ChatBubble({ mine, children }: { mine: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        maxWidth: "85%",
        background: mine ? colors.green : colors.surface,
        color: mine ? "#fff" : colors.text,
        border: mine ? "none" : `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: "10px 16px",
        fontSize: 14.5,
      }}
    >
      {children}
    </div>
  );
}
