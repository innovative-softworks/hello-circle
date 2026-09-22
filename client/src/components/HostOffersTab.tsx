import { useEffect, useState } from "react";
import { createHostGameCoupon, fetchHostGameCoupons, fetchMyGames, setHostGameCouponActive } from "../api";
import type { HostGameCoupon } from "../api";
import { TagIcon } from "./icons";
import { Button, ManageCard as Card, EmptyState, PageSpinner, inputStyle, labelStyle, tableStyle, tdStyle, thStyle } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Game } from "../types";

// Vendor-parity pass, Phase 25 — same shape as VendorOffers.tsx's
// NewCouponForm, but a specific session is always required (not "any of
// your games") — see games.ts's POST /coupons for why that's a real
// constraint, not just a simpler form.
function NewCouponForm({ games, onCreated }: { games: Game[]; onCreated: () => void }) {
  const priced = games.filter((g) => g.priceCents);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [amount, setAmount] = useState("10");
  const [gameId, setGameId] = useState(priced[0]?.id ?? "");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (priced.length === 0) {
    return <EmptyState icon={<TagIcon size={26} />} title="No priced sessions yet" subtitle="Offers only apply to a session with a price set — host a paid session first." />;
  }

  const submit = async () => {
    if (!code.trim() || !amount || !gameId) return;
    setBusy(true);
    setError(null);
    try {
      await createHostGameCoupon({ code: code.trim(), kind, amount: Number(amount), expiresAt: expiresAt || undefined, gameId });
      setCode("");
      setAmount("10");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create that offer");
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
          <label style={labelStyle}>Session</label>
          <select value={gameId} onChange={(e) => setGameId(e.target.value)} style={inputStyle}>
            {priced.map((g) => (
              <option key={g.id} value={g.id}>{g.activityLabel} — {g.date}</option>
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

export function HostOffersTab() {
  const [coupons, setCoupons] = useState<HostGameCoupon[] | null>(null);
  const [games, setGames] = useState<Game[]>([]);

  const reload = () => fetchHostGameCoupons().then(setCoupons);

  useEffect(() => {
    reload();
    fetchMyGames({ hostedOnly: true }).then(setGames);
  }, []);

  const toggle = async (c: HostGameCoupon) => {
    await setHostGameCouponActive(c.id, !c.active);
    reload();
  };

  const gameLabel = (c: HostGameCoupon) => {
    const g = games.find((g) => g.id === c.eligibleListingId);
    return g ? `${g.activityLabel} — ${g.date}` : "Session";
  };

  if (coupons === null) return <PageSpinner />;

  return (
    <div className="fade-panel">
      <NewCouponForm games={games} onCreated={reload} />
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
                  <th style={thStyle}>Session</th>
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
                    <td style={tdStyle}>{gameLabel(c)}</td>
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
