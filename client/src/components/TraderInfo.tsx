import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchListingTrader, type PublicTrader } from "../api";
import { colors, radius } from "../theme";

// Revenue & Connect Stage 4 — who the customer is buying from (DSA art. 30
// trader traceability). Renders nothing until the seller has completed and
// self-certified their trader details.

export function TraderInfo({ type, id }: { type: "centre" | "club" | "experience" | "game"; id: string }) {
  const [t, setT] = useState<PublicTrader | null>(null);
  useEffect(() => {
    fetchListingTrader(type, id).then(setT).catch(() => setT(null));
  }, [type, id]);
  if (!t) return null;
  return (
    <details style={{ border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5, color: colors.textSoft }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, color: colors.text }}>Seller information</summary>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 14px", margin: "10px 0 6px" }}>
        <dt>Seller</dt>
        <dd style={{ margin: 0 }}>{t.legalName}{t.tradingName ? ` (trading as ${t.tradingName})` : ""}</dd>
        <dt>Address</dt>
        <dd style={{ margin: 0, whiteSpace: "pre-line" }}>{t.address}, {t.country}</dd>
        <dt>Email</dt>
        <dd style={{ margin: 0 }}><a href={`mailto:${t.email}`} style={{ color: colors.greenText }}>{t.email}</a></dd>
        <dt>Phone</dt>
        <dd style={{ margin: 0 }}>{t.phone}</dd>
        {t.companyNumber && (
          <>
            <dt>Company no.</dt>
            <dd style={{ margin: 0 }}>{t.companyNumber}</dd>
          </>
        )}
        {t.vatNumber && (
          <>
            <dt>VAT no.</dt>
            <dd style={{ margin: 0 }}>{t.vatNumber}</dd>
          </>
        )}
      </dl>
      <p style={{ margin: 0, fontSize: 12, color: colors.mutedLight }}>
        The seller has certified that it only offers products and services that comply with EU law. HelloCircle takes payment on the seller's behalf.{" "}
        <Link to={`/complaints?kind=notice&subject=listing&ref=${encodeURIComponent(`${type}:${id}`)}`} style={{ color: colors.greenText }}>Report this listing</Link>
      </p>
    </details>
  );
}
