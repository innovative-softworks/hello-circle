import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { fetchPolicies, fetchPolicy, type PolicyDocument, type PolicySummary } from "../api";
import { PolicyMarkdown } from "../components/PolicyMarkdown";
import { LoadErrorState, PageSpinner } from "../components/ui";
import { colors, fonts, radius } from "../theme";

// Revenue & Connect Stage 4 — Policy Centre. Only published (or, in the
// history, retired) versions are ever shown here; drafts stay in the admin
// CMS until a legal reviewer has signed them off.

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "long", year: "numeric" }) : "");
const wrap = { maxWidth: 820, margin: "0 auto", padding: "32px 16px 64px" } as const;

export function PolicyIndex() {
  const [docs, setDocs] = useState<PolicySummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    fetchPolicies()
      .then(setDocs)
      .catch(() => setFailed(true));
  };
  useEffect(() => {
    document.title = "Policy Centre | HelloCircle";
    load();
  }, []);
  const groups: [string, string][] = [
    ["everyone", "For everyone"],
    ["customers", "Booking and payments"],
    ["partners", "For venues, clubs and organisations"],
    ["hosts", "For hosts"],
  ];
  return (
    <section style={wrap}>
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(32px, 3.8vw, 52px)", margin: "0 0 8px" }}>Policy Centre</h1>
      <p style={{ color: colors.textSoft, fontSize: 15, margin: "0 0 26px" }}>
        The terms and policies that apply to using HelloCircle. Questions or problems? <Link to="/complaints" style={{ color: colors.greenText, fontWeight: 600 }}>Contact us or appeal a decision</Link>.
      </p>
      {failed ? (
        <LoadErrorState title="We couldn't load the policies." onRetry={load} />
      ) : !docs ? (
        <PageSpinner />
      ) : (
        groups.map(([aud, label]) => {
          const list = docs.filter((d) => d.audience === aud);
          if (!list.length) return null;
          return (
            <section key={aud} style={{ marginBottom: 24 }}>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: "0 0 10px" }}>{label}</h2>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, border: `1px solid ${colors.border}`, borderRadius: radius.control }}>
                {list.map((d, i) => (
                  <li key={d.docKey} style={{ padding: "12px 14px", borderTop: i ? `1px solid ${colors.border}` : "none", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <Link to={`/policies/${d.docKey}`} style={{ color: colors.text, fontWeight: 600, textDecoration: "none", display: "inline-block", padding: "3px 0" }}>
                      {d.title}
                    </Link>
                    <span style={{ fontSize: 12.5, color: colors.mutedLight }}>{d.publishedVersion ? `Version ${d.publishedVersion} · ${day(d.publishedAt)}` : "Being prepared"}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </section>
  );
}

function PolicyView({ docKey, version, extra, fallback }: { docKey: string; version?: number; extra?: ReactNode; fallback?: ReactNode }) {
  const [doc, setDoc] = useState<PolicyDocument | null | "error">(null);
  useEffect(() => {
    setDoc(null);
    fetchPolicy(docKey, version)
      .then((d) => {
        setDoc(d);
        document.title = `${d.title} | HelloCircle`;
      })
      .catch(() => setDoc("error"));
  }, [docKey, version]);

  if (doc === null) return fallback ? null : <PageSpinner />;
  if (doc === "error" || !doc.published) {
    if (fallback) return <>{fallback}</>;
    return (
      <section style={wrap}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(32px, 3.8vw, 52px)", margin: "0 0 10px" }}>{doc === "error" ? "Policy not found" : doc.title}</h1>
        <p style={{ color: colors.textSoft }}>{doc === "error" ? "We couldn't find that policy." : "This document is being prepared and hasn't been published yet."}</p>
        <Link to="/policies" style={{ color: colors.greenText, fontWeight: 600 }}>All policies</Link>
      </section>
    );
  }
  const pub = doc.published;
  return (
    <section style={wrap}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <Link to="/policies" style={{ color: colors.greenText, fontWeight: 600, fontSize: 14 }}>← Policy Centre</Link>
        <button type="button" onClick={() => window.print()} style={{ border: `1px solid ${colors.border}`, background: "transparent", borderRadius: radius.control, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>
          Print
        </button>
      </div>
      {pub.status === "retired" && (
        <p role="status" style={{ background: colors.orangeBg, color: colors.orangeDark, padding: "10px 14px", borderRadius: radius.control, fontSize: 14 }}>
          This is an earlier version, no longer in force. <Link to={`/policies/${docKey}`} style={{ color: colors.orangeDark, fontWeight: 700 }}>See the current version</Link>.
        </p>
      )}
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(32px, 3.8vw, 52px)", margin: "0 0 6px" }}>{doc.title}</h1>
      <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 24px" }}>
        Version {pub.version} · effective {day(pub.effectiveFrom ?? pub.publishedAt)}
      </p>
      <PolicyMarkdown source={pub.body} hideTitle />
      {extra}
      {pub.history.length > 1 && (
        <section className="no-print" style={{ marginTop: 36, borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 8px" }}>Version history</h2>
          <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13.5, color: colors.textSoft, lineHeight: 1.7 }}>
            {pub.history.map((h) => (
              <li key={h.version}>
                {h.version === pub.version ? <strong>Version {h.version}</strong> : <Link to={`/policies/${docKey}?version=${h.version}`} style={{ color: colors.greenText }}>Version {h.version}</Link>} — {day(h.publishedAt)}
                {h.status === "retired" && h.retiredAt ? ` to ${day(h.retiredAt)}` : " (current)"}
                {h.changeSummary ? ` · ${h.changeSummary}` : ""}
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 11.5, color: colors.mutedLight, marginTop: 10, wordBreak: "break-all" }}>Content fingerprint (SHA-256): {pub.contentHash}</p>
        </section>
      )}
    </section>
  );
}

export function PolicyPage() {
  const { key = "" } = useParams();
  const [params] = useSearchParams();
  const v = Number(params.get("version"));
  return <PolicyView docKey={key} version={Number.isInteger(v) && v > 0 ? v : undefined} />;
}

/** /privacy and /cookies: the published CMS version once there is one,
 * otherwise the existing page, unchanged. */
export function CmsPolicy({ docKey, fallback, extra }: { docKey: string; fallback: ReactNode; extra?: ReactNode }) {
  return <PolicyView docKey={docKey} fallback={fallback} extra={extra} />;
}
