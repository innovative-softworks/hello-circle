import { useEffect, useState } from "react";
import { createVendorCoupon, fetchVendorCoupons, fetchVendorListings, setVendorCouponActive } from "../api";
import type { VendorCoupon } from "../api";
import { TagIcon } from "./icons";
import { Button, ManageCard as Card, EmptyState, PageSpinner, inputStyle, labelStyle, tableStyle, tdStyle, thStyle } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { VendorListingSummary } from "../types";

// Host Manage spec §17 — vendor self-service promo codes, didn't exist at
// all before (coupons were strictly admin/platform-wide, routes/admin.ts).
// No "early-bird"/"group discount" special kinds — those are really a
// percent/fixed coupon plus a date window (already have expiresAt) or a
// min-quantity concept that doesn't exist anywhere in the pricing engine
// today; adding one is real pricing-engine work, out of scope here.
function NewCouponForm({ listings, onCreated }: { listings: { centres: VendorListingSummary[]; clubs: VendorListingSummary[] }; onCreated: () => void }) {
  const options = [
    { listingType: "centre" as const, listingId: "", name: "Any of your listings" },
    ...listings.centres.map((c) => ({ listingType: "centre" as const, listingId: c.id, name: c.name })),
    ...listings.clubs.map((c) => ({ listingType: "club" as const, listingId: c.id, name: c.name })),
  ];
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [amount, setAmount] = useState("10");
  const [target, setTarget] = useState("centre:");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim() || !amount) return;
    setBusy(true);
    setError(null);
    const [listingType, listingId] = target.split(":") as ["centre" | "club", string];
    try {
      await createVendorCoupon({
        code: code.trim(),
        kind,
        amount: Number(amount),
        expiresAt: expiresAt || undefined,
        eligibleListingType: listingId ? listingType : undefined,
        eligibleListingId: listingId || undefined,
      });
      setCode("");
      setAmount("10");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create that coupon");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: 20 }}>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Create an offer</h4>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: "1 1 140px" }}>
          <label style={labelStyle}>Code</label>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={inputStyle} placeholder="SUMMER10" />
        </div>
        <div style={{ flex: "1 1 100px" }}>
          <label style={labelStyle}>Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as "percent" | "fixed")} style={inputStyle}>
            <option value="percent">Percent off</option>
            <option value="fixed">€ off</option>
          </select>
        </div>
        <div style={{ flex: "1 1 100px" }}>
          <label style={labelStyle}>{kind === "percent" ? "Percent" : "Cents off"}</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: "1 1 200px" }}>
          <label style={labelStyle}>Eligible listing</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={inputStyle}>
            {options.map((o) => (
              <option key={`${o.listingType}:${o.listingId}`} value={`${o.listingType}:${o.listingId}`}>{o.name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 160px" }}>
          <label style={labelStyle}>Expires (optional)</label>
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} style={inputStyle} />
        </div>
      </div>
      {error && <p style={{ color: colors.danger, fontSize: 12.5, marginBottom: 10 }}>{error}</p>}
      <Button onClick={submit} disabled={busy || !code.trim()}>{busy ? "Creating…" : "Create offer"}</Button>
    </Card>
  );
}

export function VendorOffersTab() {
  const [coupons, setCoupons] = useState<VendorCoupon[] | null>(null);
  const [listings, setListings] = useState<{ centres: VendorListingSummary[]; clubs: VendorListingSummary[] }>({ centres: [], clubs: [] });

  const reload = () => fetchVendorCoupons().then(setCoupons);

  useEffect(() => {
    reload();
    fetchVendorListings().then(setListings);
  }, []);

  const toggle = async (c: VendorCoupon) => {
    await setVendorCouponActive(c.id, !c.active);
    reload();
  };

  const listingName = (c: VendorCoupon) => {
    if (!c.eligibleListingId) return "Any listing";
    const pool = c.eligibleListingType === "centre" ? listings.centres : listings.clubs;
    return pool.find((l) => l.id === c.eligibleListingId)?.name ?? c.eligibleListingType;
  };

  if (coupons === null) return <PageSpinner />;

  return (
    <div className="fade-panel">
      <NewCouponForm listings={listings} onCreated={reload} />
      {coupons.length === 0 ? (
        <EmptyState icon={<TagIcon size={26} />} title="No offers yet" />
      ) : (
        <Card>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Discount</th>
                  <th style={thStyle}>Eligible</th>
                  <th style={thStyle}>Uses</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => (
                  <tr key={c.id}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{c.code}</td>
                    <td style={tdStyle}>{c.kind === "percent" ? `${c.amount}%` : `€${(c.amount / 100).toFixed(2)}`}</td>
                    <td style={tdStyle}>{listingName(c)}</td>
                    <td style={tdStyle}>{c.usedCount}{c.maxUses ? `/${c.maxUses}` : ""}</td>
                    <td style={tdStyle}>
                      {c.active ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px" }}>Active</span>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: radius.pill, padding: "2px 8px" }}>Paused</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <Button variant="ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => toggle(c)}>
                        {c.active ? "Pause" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
