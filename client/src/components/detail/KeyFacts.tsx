import type { ReactNode } from "react";
import { colors, fonts } from "../../theme";

// Detail-page redesign (master brief, 2026-10-22). Shared building blocks for
// the dated detail pages (activity, adventure/experience/volunteer,
// programme): the facts are shown once, under the title, and the sections
// further down never repeat them (audit DP-04).

/** One key fact: an icon and a short value ("5h", "16 km", "Up to 10"). */
export interface KeyFact {
  icon?: ReactNode;
  value: string;
  label: string;
}

/** The single facts row under the title — an even grid (owner, 2026-10-22). */
export function KeyFacts({ facts }: { facts: (KeyFact | null | false | undefined)[] }) {
  const shown = facts.filter((f): f is KeyFact => !!f && !!f.value);
  if (shown.length === 0) return null;
  return (
    <dl aria-label="Key facts" className="fact-grid" style={{ margin: "20px 0 0", paddingTop: 18, borderTop: `1px solid ${colors.border}` }}>
      {shown.map((f) => (
        <div key={f.label} style={{ minWidth: 0 }}>
          {f.icon && <div aria-hidden="true" style={{ color: colors.mutedLight, marginBottom: 6, display: "flex" }}>{f.icon}</div>}
          <dd style={{ margin: 0, fontFamily: fonts.display, fontWeight: 800, fontSize: 18, lineHeight: 1.2, overflowWrap: "anywhere" }}>{f.value}</dd>
          <dt style={{ margin: "2px 0 0", fontSize: 12.5, color: colors.mutedLight }}>{f.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Requirements ("Is this right for you?") — difficulty, fitness, age,
 * accessibility, eligibility … only the fields this listing actually has. */
export function Requirements({ title = "Is this right for you?", rows }: { title?: string; rows: { label: string; value: string | null | undefined }[] }) {
  const shown = rows.filter((r): r is { label: string; value: string } => !!r.value && !!r.value.trim());
  if (shown.length === 0) return null;
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 14px" }}>{title}</h2>
      <dl style={{ margin: 0, display: "grid", gap: 12 }}>
        {shown.map((r) => (
          <div key={r.label} className="requirement-row">
            <dt style={{ fontWeight: 700, color: colors.text }}>{r.label}</dt>
            <dd style={{ margin: 0, color: colors.textSoft, whiteSpace: "pre-wrap" }}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The honest label next to a list price (owner decision 2026-10-22): the
 * total — VAT and the booking fee included — only ever comes from the server
 * quote in the booking step. */
export const PAID_PRICE_NOTE = "+ VAT & booking fee at checkout";
