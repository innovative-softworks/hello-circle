import { MinusIcon, PlusIcon } from "../icons";
import { colors, radius } from "../../theme";
import { formatPrice } from "../../formatters";
import type { RegistrationOption } from "../../types";

// Participation Phase 1 — the options step of an experience/event booking
// (e.g. KNOTS: "Participate in Pooja" per family, "Individual Darshan" per
// person, an optional extra). Shows only what the server published; the
// price is always the server's quote, never computed here — this only
// collects quantities. Each stepper button names its option for screen readers.

export type OptionQuantities = Record<string, number>;

/** People a selection includes (display only — the server decides). */
export function headsOf(options: RegistrationOption[], qty: OptionQuantities): number {
  return options.reduce((n, o) => n + (o.kind === "addon" ? 0 : (qty[o.id] ?? 0) * o.headsPerUnit), 0);
}

export function selectedLines(qty: OptionQuantities): { optionId: string; quantity: number }[] {
  return Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([optionId, quantity]) => ({ optionId, quantity }));
}

function basisText(o: RegistrationOption): string {
  if (o.kind === "addon") return o.priceBasis === "per_person" ? "per person" : "per booking";
  if (o.priceBasis === "per_person") return "per person";
  return o.headsPerUnit > 1 ? `per booking · includes ${o.headsPerUnit} people` : "per booking";
}

export function OptionPicker({
  options,
  qty,
  onChange,
  left,
  placesLeft,
}: {
  options: RegistrationOption[];
  qty: OptionQuantities;
  onChange: (next: OptionQuantities) => void;
  /** Places left per option on the chosen date (null = no own limit). */
  left?: Record<string, number | null>;
  /** Places left on the date overall (people). */
  placesLeft: number;
}) {
  const heads = headsOf(options, qty);
  const main = options.filter((o) => o.kind !== "addon");
  const extras = options.filter((o) => o.kind === "addon");
  const row = (o: RegistrationOption) => {
    const q = qty[o.id] ?? 0;
    const ownLeft = left?.[o.id] ?? null;
    const unitHeads = o.kind === "addon" ? 0 : o.headsPerUnit;
    // The most one more unit allows: its own limit, max per booking, the date's places and (per-person extras) the head count.
    const canAdd =
      o.onSale &&
      (o.maxPerOrder === null || q < o.maxPerOrder) &&
      (ownLeft === null || (o.kind === "addon" ? q + 1 <= ownLeft : (q + 1) * unitHeads <= ownLeft)) &&
      heads + unitHeads <= placesLeft &&
      !(o.kind === "addon" && o.priceBasis === "per_person" && q + 1 > heads);
    const soldOut = ownLeft === 0;
    const set = (n: number) => onChange({ ...qty, [o.id]: Math.max(0, n) });
    const btn = (disabled: boolean) => ({
      width: 36,
      height: 36,
      borderRadius: "50%",
      border: `1px solid ${colors.borderStrong}`,
      background: colors.surface,
      color: colors.text,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.4 : 1,
      flex: "none" as const,
    });
    return (
      <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 14px", border: `1.5px solid ${q > 0 ? colors.green : colors.border}`, borderRadius: radius.control, background: colors.surface, opacity: o.onSale && !soldOut ? 1 : 0.6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{o.label}</div>
          {o.description && <div style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>{o.description}</div>}
          <div style={{ fontSize: 13, marginTop: 4 }}>
            <strong>{o.priceMinor ? formatPrice(o.priceMinor) : "Free"}</strong> <span style={{ color: colors.muted }}>{basisText(o)}</span>
          </div>
          {!o.onSale ? (
            <div style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }}>Not on sale right now</div>
          ) : soldOut ? (
            <div style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }}>Sold out for this date</div>
          ) : ownLeft !== null && ownLeft <= 5 ? (
            <div style={{ fontSize: 12.5, color: colors.orangeDark, marginTop: 2 }}>{ownLeft} left</div>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <button type="button" onClick={() => set(q - 1)} disabled={q === 0} aria-label={`Remove one ${o.label}`} style={btn(q === 0)}>
            <MinusIcon size={14} />
          </button>
          <span aria-live="polite" aria-label={`${q} ${o.label}`} style={{ fontSize: 17, fontWeight: 700, minWidth: 20, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{q}</span>
          <button type="button" onClick={() => set(q + 1)} disabled={!canAdd} aria-label={`Add one ${o.label}`} style={btn(!canAdd)}>
            <PlusIcon size={14} />
          </button>
        </div>
      </div>
    );
  };
  return (
    <div role="group" aria-label="Registration options" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {main.map(row)}
      {extras.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 6 }}>Extras</div>
          {extras.map(row)}
        </>
      )}
      <div style={{ fontSize: 13, color: colors.muted }}>{heads === 0 ? "Choose at least one option to continue." : `${heads} ${heads === 1 ? "person" : "people"} in this booking.`}</div>
    </div>
  );
}
