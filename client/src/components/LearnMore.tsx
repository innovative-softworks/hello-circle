import { useState } from "react";
import { colors, fonts } from "../theme";
import { useFieldHelp } from "./FieldHelp";
import { Drawer } from "./ui";

// Stage 5f — contextual help: a short line inline, "Learn more" opens a
// drawer with the full admin-editable help entry and its policy link. The
// words are never in this component (help_entries; Admin → Help).

export function HelpLine({ helpKey, fallback }: { helpKey: string; fallback?: string }) {
  const entry = useFieldHelp(helpKey);
  const text = entry?.definition ?? fallback;
  if (!text) return null;
  return <p style={{ fontSize: 13, color: colors.muted, margin: "6px 0", lineHeight: 1.5 }}>{text}</p>;
}

export function LearnMore({ helpKey, label = "Learn more" }: { helpKey: string; label?: string }) {
  const entry = useFieldHelp(helpKey);
  const [open, setOpen] = useState(false);
  if (!entry) return null;
  const rows: [string, string | null][] = [
    ["How it's worked out", entry.formula],
    ["Example", entry.example],
    ["Who pays", entry.whoPays],
    ["When", entry.whenCharged],
    ["Refunds", entry.refundBehaviour],
  ];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ background: "none", border: "none", padding: 0, color: colors.text, fontWeight: 700, textDecoration: "underline", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}
        aria-haspopup="dialog"
      >
        {label}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={entry.name}>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, margin: "0 0 14px" }}>{entry.definition}</p>
        <dl style={{ margin: 0 }}>
          {rows
            .filter(([, v]) => v && v !== "—")
            .map(([k, v]) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <dt style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 13 }}>{k}</dt>
                <dd style={{ margin: "2px 0 0", fontSize: 14, color: colors.textSoft, lineHeight: 1.5 }}>{v}</dd>
              </div>
            ))}
        </dl>
        {entry.policyKey && entry.policyKey !== "—" && (
          <a href={`/policies/${entry.policyKey}`} style={{ color: colors.text, fontWeight: 700, fontSize: 13.5 }}>
            Read the full policy
          </a>
        )}
      </Drawer>
    </>
  );
}
