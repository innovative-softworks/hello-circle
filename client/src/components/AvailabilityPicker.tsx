import { useId, useState, type CSSProperties } from "react";
import {
  AVAILABILITY_PRESETS,
  DAY_LABELS,
  DAYS,
  presetSelected,
  SLOT_LABELS,
  SLOTS,
  token,
  togglePreset,
  toggleToken,
} from "../participationVocab";
import { colors, radius } from "../theme";

// Recurring availability (community participation upgrade, Release 2) —
// quick presets first (one tap covers most people), with the full
// day × morning/afternoon/evening grid behind "Customise" so the default
// view stays short on a phone. Not a calendar: just when someone is
// usually free. Controlled; the value is a list of "day:slot" tokens.

const chip = (active: boolean): CSSProperties => ({
  border: `1px solid ${active ? colors.green : colors.border}`,
  background: active ? colors.greenBg : colors.surface,
  color: active ? colors.greenText : colors.text,
  borderRadius: radius.pill,
  padding: "6px 12px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
});

export function AvailabilityPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [customising, setCustomising] = useState(false);
  const gridId = useId();

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {AVAILABILITY_PRESETS.map((p) => {
          const active = presetSelected(value, p);
          return (
            <button key={p.label} type="button" aria-pressed={active} onClick={() => onChange(togglePreset(value, p))} style={chip(active)}>
              {p.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        aria-expanded={customising}
        aria-controls={gridId}
        onClick={() => setCustomising((c) => !c)}
        style={{ background: "none", border: "none", padding: 0, marginTop: 12, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer", textDecoration: "underline" }}
      >
        {customising ? "Hide day-by-day" : "Customise day by day"}
      </button>
      {customising && (
        <div id={gridId} style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 4, fontSize: 12 }}>
            <thead>
              <tr>
                <th />
                {DAYS.map((d) => (
                  <th key={d} scope="col" style={{ fontWeight: 700, color: colors.muted, padding: "0 2px" }}>{DAY_LABELS[d]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SLOTS.map((s) => (
                <tr key={s}>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 700, color: colors.muted, paddingRight: 6, whiteSpace: "nowrap" }}>{SLOT_LABELS[s]}</th>
                  {DAYS.map((d) => {
                    const t = token(d, s);
                    const on = value.includes(t);
                    return (
                      <td key={t}>
                        <button
                          type="button"
                          aria-pressed={on}
                          aria-label={`${DAY_LABELS[d]} ${SLOT_LABELS[s].toLowerCase()}`}
                          onClick={() => onChange(toggleToken(value, t))}
                          style={{
                            width: 36,
                            height: 32,
                            borderRadius: 8,
                            border: `1px solid ${on ? colors.green : colors.border}`,
                            background: on ? colors.green : colors.surface,
                            cursor: "pointer",
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
