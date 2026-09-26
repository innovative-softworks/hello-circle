import { useId, useState } from "react";
import { fitLabel } from "../recommendationFit";
import { colors, radius } from "../theme";
import { CheckIcon } from "./icons";

// "Why this is recommended" (community participation upgrade, Release 1) —
// a plain-language fit label plus the real reasons the server's
// personalisation returned (personalization.ts's matchReasons), revealed
// inline on tap rather than in a popover, so it works the same on a phone.
// Renders nothing for a result with no reasons: an unexplained "Good fit"
// would be exactly the false signal this is meant to avoid.

export function WhyRecommended({ reasons, label: serverLabel }: { reasons: readonly string[] | undefined; label?: string | null }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  // Release 4: the server's weighted label when it sent one; the Release 1
  // reason-count fallback otherwise (e.g. an older server).
  const label = serverLabel !== undefined ? (reasons?.length ? serverLabel : null) : fitLabel(reasons);
  if (!label || !reasons) return null;

  return (
    <div className="stretched-link-above" style={{ marginTop: 2 }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-controls={listId}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: colors.greenBg,
          color: colors.greenText,
          border: "none",
          borderRadius: radius.pill,
          padding: "3px 9px",
          fontSize: 11.5,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {label}
        <span style={{ fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2 }}>{open ? "Hide" : "Why?"}</span>
      </button>
      {open && (
        <ul id={listId} style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          {reasons.map((r) => (
            <li key={r} style={{ display: "flex", alignItems: "flex-start", gap: 5, fontSize: 12, color: colors.muted, lineHeight: 1.35 }}>
              <CheckIcon size={12} style={{ color: colors.green, flexShrink: 0, marginTop: 1 }} />
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
