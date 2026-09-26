import { PARTICIPATION_ATTRIBUTES } from "../participationVocab";
import { colors, radius } from "../theme";

// "Participation experience" attribute picker (Release 2) — shared by the
// host game form and the vendor editor. Every attribute is an explicit
// claim the host makes about their own activity; nothing is pre-ticked or
// inferred. Controlled; the value is a list of attribute keys.

export function AttributePicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const toggle = (key: string) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  return (
    <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {PARTICIPATION_ATTRIBUTES.map((a) => {
        const on = value.includes(a.key);
        return (
          <label
            key={a.key}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              borderRadius: radius.control,
              border: `1px solid ${on ? colors.green : colors.border}`,
              background: on ? colors.greenBg : colors.surface,
              cursor: "pointer",
            }}
          >
            <input type="checkbox" checked={on} onChange={() => toggle(a.key)} style={{ marginTop: 3 }} />
            <span>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: colors.text }}>{a.label}</span>
              <span style={{ display: "block", fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 1.35 }}>{a.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
