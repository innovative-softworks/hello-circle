import { Fragment, useMemo, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { parsePolicy, type Inline } from "../policyMarkdown";
import { colors, fonts } from "../theme";

// Revenue & Connect Stage 4 — renders policy text (see policyMarkdown.ts)
// as React elements only. Unresolved [[PLACEHOLDERS]] are highlighted so a
// draft preview makes the gaps obvious.

const p: CSSProperties = { color: colors.textSoft, fontSize: 15, lineHeight: 1.65, margin: "0 0 12px" };
const hStyle = (level: number): CSSProperties => ({
  fontFamily: fonts.display,
  fontWeight: 700,
  fontSize: level === 1 ? 30 : level === 2 ? 19 : 16,
  margin: level === 1 ? "0 0 16px" : "26px 0 10px",
  letterSpacing: "-.01em",
});
const mark: CSSProperties = { background: colors.orangeBg, color: colors.orangeDark, padding: "1px 5px", borderRadius: 5, fontWeight: 600 };

function Text({ v }: { v: string }) {
  const parts = v.split(/(\[\[[A-Z0-9_]+\]\])/g);
  return (
    <>
      {parts.map((part, i) => (/^\[\[[A-Z0-9_]+\]\]$/.test(part) ? <span key={i} style={mark}>{part}</span> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

function Inlines({ v }: { v: Inline[] }) {
  return (
    <>
      {v.map((n, i) =>
        n.t === "text" ? (
          <Text key={i} v={n.v} />
        ) : n.t === "bold" ? (
          <strong key={i} style={{ color: colors.text }}>
            <Inlines v={n.v} />
          </strong>
        ) : n.href.startsWith("/") ? (
          <Link key={i} to={n.href} style={{ color: colors.greenText, fontWeight: 600 }}>
            {n.v}
          </Link>
        ) : (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" style={{ color: colors.greenText, fontWeight: 600 }}>
            {n.v}
          </a>
        )
      )}
    </>
  );
}

export function PolicyMarkdown({ source, hideTitle }: { source: string; hideTitle?: boolean }) {
  const blocks = useMemo(() => parsePolicy(source), [source]);
  return (
    <div className="policy-body">
      {blocks.map((b, i) => {
        if (b.t === "h") {
          if (b.level === 1 && hideTitle) return null;
          const H = (`h${b.level}` as "h1" | "h2" | "h3");
          return (
            <H key={i} id={b.id} style={hStyle(b.level)}>
              <Inlines v={b.v} />
            </H>
          );
        }
        if (b.t === "p")
          return (
            <p key={i} style={p}>
              <Inlines v={b.v} />
            </p>
          );
        const L = b.t;
        return (
          <L key={i} style={{ paddingLeft: 22, margin: "0 0 12px" }}>
            {b.items.map((it, j) => (
              <li key={j} style={{ ...p, margin: "0 0 6px" }}>
                <Inlines v={it} />
              </li>
            ))}
          </L>
        );
      })}
    </div>
  );
}
