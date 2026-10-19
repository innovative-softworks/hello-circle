import { useEffect, useId, useState } from "react";
import { fetchFieldHelp, type FieldHelpEntry } from "../api";
import { colors, fonts, radius } from "../theme";

// Revenue & Connect Stage 3 — contextual help for financial fields (brief
// §19D). The words come from the admin-editable help entries (server
// routes/help.ts), never from this component, so finance/legal can correct
// a definition without a deploy. One fetch per page load, shared by every
// FieldHelp on the page.

let cache: Promise<Map<string, FieldHelpEntry>> | null = null;

function loadHelp(): Promise<Map<string, FieldHelpEntry>> {
  if (!cache) {
    cache = fetchFieldHelp()
      .then((rows) => new Map(rows.map((r) => [r.helpKey, r])))
      .catch(() => {
        cache = null; // retry on the next open rather than caching a failure
        return new Map();
      });
  }
  return cache;
}

export function useFieldHelp(key: string): FieldHelpEntry | null {
  const [entry, setEntry] = useState<FieldHelpEntry | null>(null);
  useEffect(() => {
    let live = true;
    loadHelp().then((m) => live && setEntry(m.get(key) ?? null));
    return () => {
      live = false;
    };
  }, [key]);
  return entry;
}

const row = { fontSize: 12.5, lineHeight: 1.5, margin: "4px 0 0", color: colors.textSoft } as const;
const label = { fontWeight: 700, color: colors.text } as const;

/** A small ⓘ toggle that expands the field's help inline (keyboard and
 * screen-reader friendly: a real button with aria-expanded/aria-controls). */
export function FieldHelp({ helpKey, label: fallbackLabel }: { helpKey: string; label?: string }) {
  const entry = useFieldHelp(helpKey);
  const [open, setOpen] = useState(false);
  const id = useId();
  const name = entry?.name ?? fallbackLabel ?? helpKey;
  return (
    <span style={{ display: "inline" }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`What is ${name}?`}
        onClick={() => setOpen((o) => !o)}
        style={{
          border: `1px solid ${colors.border}`,
          background: open ? colors.panel : "transparent",
          color: colors.muted,
          borderRadius: "50%",
          width: 18,
          height: 18,
          fontSize: 11,
          fontWeight: 700,
          lineHeight: "16px",
          padding: 0,
          marginLeft: 6,
          cursor: "pointer",
          verticalAlign: "middle",
        }}
      >
        i
      </button>
      {open && (
        <span id={id} role="note" style={{ display: "block", marginTop: 8, padding: "10px 12px", background: colors.panel, borderRadius: radius.control, fontFamily: fonts.body }}>
          {entry ? (
            <>
              <span style={{ ...row, display: "block", marginTop: 0 }}>{entry.definition}</span>
              {entry.formula && <span style={{ ...row, display: "block" }}><span style={label}>How it's worked out: </span>{entry.formula}</span>}
              {entry.example && <span style={{ ...row, display: "block" }}><span style={label}>Example: </span>{entry.example}</span>}
              {entry.whoPays && entry.whoPays !== "—" && <span style={{ ...row, display: "block" }}><span style={label}>Who pays: </span>{entry.whoPays}</span>}
              {entry.whenCharged && entry.whenCharged !== "—" && <span style={{ ...row, display: "block" }}><span style={label}>When: </span>{entry.whenCharged}</span>}
              {entry.refundBehaviour && entry.refundBehaviour !== "—" && <span style={{ ...row, display: "block" }}><span style={label}>If refunded: </span>{entry.refundBehaviour}</span>}
              <a href={`/policies/${entry.policyKey}`} style={{ ...row, display: "inline-block", color: colors.greenText, fontWeight: 600 }}>Read the full policy</a>
            </>
          ) : (
            <span style={{ ...row, marginTop: 0 }}>Help for this field isn't available right now.</span>
          )}
        </span>
      )}
    </span>
  );
}
