import { colors, radius } from "../theme";
import { PRICE_SIGNAL_LABELS, type PriceSignal } from "../priceSignal";

// Commercial UX R1 (C1) — "Free" / "Free trial" on listing cards. Text, not
// colour alone, carries the meaning; `onPhoto` matches the white photo badges
// already used on activity cards.

export function PriceChip({ signal, onPhoto = false }: { signal: PriceSignal; onPhoto?: boolean }) {
  return (
    <span
      data-price-signal={signal}
      className={onPhoto ? "card-photo-badge" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap",
        fontSize: onPhoto ? 11.5 : 12,
        fontWeight: 700,
        lineHeight: 1.3,
        color: colors.greenText,
        background: onPhoto ? "rgba(255,255,255,.94)" : colors.greenBg,
        borderRadius: radius.pill,
        padding: onPhoto ? "4px 10px" : "3px 10px",
        transition: onPhoto ? "background-color .2s ease, color .2s ease" : undefined,
      }}
    >
      {PRICE_SIGNAL_LABELS[signal]}
    </span>
  );
}
