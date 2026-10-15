import { useEffect, useState } from "react";
import { decideVenueSplit, fetchFieldHelp, fetchGameSplits, fetchMyGames, fetchSplitStatus, fetchVenueSplits, proposeGameSplit, type FieldHelpEntry, type VenueSplitAgreement } from "../api";
import type { Game } from "../types";
import { colors, fonts, radius } from "../theme";
import { Button, inputStyle, ManageCard as Card, tableStyle, tdStyle, thStyle } from "./ui";

// Revenue & Connect Stage 5e — venue/host split agreements (flow C).
// Host: proposes how the partner share of a paid game at a venue is divided.
// Venue (organisation owner / finance staff): accepts or declines. The accepted
// split is frozen into each booking when it is paid. Explanation text comes
// from the editable help entry "venue_split".

const euro = (minor: number | null) => (minor === null ? "—" : `€${(Number(minor) / 100).toFixed(2)}`);
const terms = (a: VenueSplitAgreement) =>
  a.mode === "percentage" ? `Venue ${(Number(a.venueBps) / 100).toFixed(2)}% · host ${((10_000 - Number(a.venueBps)) / 100).toFixed(2)}%` : a.mode === "fixed_venue" ? `Venue fixed ${euro(a.venueFixedMinor)} · host the rest` : `Host fixed ${euro(a.hostFixedMinor)} · venue the rest`;
const STATUS: Record<VenueSplitAgreement["status"], string> = { proposed: "Waiting for the venue", accepted: "Agreed", declined: "Declined", withdrawn: "Replaced", superseded: "Replaced by a newer agreement" };

function useSplitHelp() {
  const [help, setHelp] = useState<FieldHelpEntry | null>(null);
  useEffect(() => {
    fetchFieldHelp(["venue_split"]).then((r) => setHelp(r[0] ?? null)).catch(() => setHelp(null));
  }, []);
  return help;
}

export function VenueSplitsCard({ scope }: { scope: "vendor" | "host" }) {
  return scope === "vendor" ? <VenueSide /> : <HostSide />;
}

function VenueSide() {
  const [rows, setRows] = useState<VenueSplitAgreement[] | null>(null);
  const [reason, setReason] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const help = useSplitHelp();
  const [loadFailed, setLoadFailed] = useState(false);
  const load = () =>
    fetchVenueSplits()
      .then((r) => {
        setRows(r);
        setLoadFailed(false);
      })
      .catch((e: unknown) => {
        if ((e as { status?: number })?.status !== 403) setLoadFailed(true);
      });
  useEffect(() => {
    load();
  }, []);
  if (loadFailed && !rows) return <p role="alert" style={{ fontSize: 13.5 }}>Couldn't load venue/host split proposals. Refresh to try again.</p>;
  if (!rows || rows.length === 0) return null;
  const decide = async (id: number, accept: boolean) => {
    setError(null);
    try {
      await decideVenueSplit(id, accept, reason[id]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  return (
    <Card style={{ padding: 20 }}>
      <h2 data-testid="venue-splits" style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 4px" }}>Venue / host splits</h2>
      {help && <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px", lineHeight: 1.5 }}>{help.definition}</p>}
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Game</th><th style={thStyle}>Split</th><th style={thStyle}>Status</th><th style={thStyle}></th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td style={tdStyle}>{a.gameTitle ?? a.gameId}<div style={{ fontSize: 11.5, color: colors.mutedLight }}>version {a.version}</div></td>
                <td style={tdStyle}>{terms(a)}</td>
                <td style={tdStyle}>{STATUS[a.status]}{a.decisionReason ? ` — ${a.decisionReason}` : ""}</td>
                <td style={{ ...tdStyle, minWidth: 220 }}>
                  {a.status === "proposed" && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <Button onClick={() => decide(a.id, true)}>Accept</Button>
                      <input aria-label="Reason for declining" placeholder="Reason (to decline)" value={reason[a.id] ?? ""} onChange={(e) => setReason({ ...reason, [a.id]: e.target.value })} style={{ ...inputStyle, flex: "1 1 120px", minWidth: 0 }} />
                      <Button variant="ghost" onClick={() => decide(a.id, false)}>Decline</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p role="alert" style={{ color: colors.danger, background: colors.dangerBg, padding: "8px 12px", borderRadius: radius.control, fontSize: 13, marginTop: 10 }}>{error}</p>}
    </Card>
  );
}

function HostSide() {
  const [games, setGames] = useState<Game[] | null>(null);
  const [splits, setSplits] = useState<Record<string, VenueSplitAgreement[]>>({});
  const [form, setForm] = useState<Record<string, { mode: VenueSplitAgreement["mode"]; value: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const help = useSplitHelp();
  useEffect(() => {
    fetchSplitStatus()
      .then(({ enabled }) => (enabled ? fetchMyGames({ hostedOnly: true }) : []))
      .then(async (all) => {
        const eligible = all.filter((g) => g.centreId && Number(g.priceCents ?? 0) > 0);
        setGames(eligible);
        const entries = await Promise.all(eligible.map(async (g) => [g.id, await fetchGameSplits(g.id).catch(() => [])] as const));
        setSplits(Object.fromEntries(entries));
      })
      .catch(() => setGames(null));
  }, []);
  if (!games || games.length === 0) return null;
  const propose = async (g: Game) => {
    setError(null);
    const f = form[g.id] ?? { mode: "percentage", value: "" };
    const n = Number(f.value);
    if (!Number.isFinite(n) || n < 0) return setError("Enter a number");
    try {
      const a =
        f.mode === "percentage"
          ? await proposeGameSplit(g.id, { mode: "percentage", venueBps: Math.round(n * 100) })
          : await proposeGameSplit(g.id, f.mode === "fixed_venue" ? { mode: "fixed_venue", venueFixedMinor: Math.round(n * 100) } : { mode: "fixed_host", hostFixedMinor: Math.round(n * 100) });
      setSplits({ ...splits, [g.id]: [a, ...(splits[g.id] ?? []).map((x) => (x.status === "proposed" ? { ...x, status: "withdrawn" as const } : x))] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't propose the split");
    }
  };
  return (
    <Card style={{ padding: 20 }}>
      <h2 data-testid="host-splits" style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 4px" }}>Splits with venues</h2>
      {help && <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px", lineHeight: 1.5 }}>{help.definition}</p>}
      {games.map((g) => {
        const current = (splits[g.id] ?? [])[0];
        const f = form[g.id] ?? { mode: "percentage" as const, value: "" };
        return (
          <div key={g.id} style={{ borderTop: `1px solid ${colors.border}`, padding: "10px 0", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{g.activityLabel} · {g.centreName ?? "venue"}</div>
              <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{current ? `${terms(current)} — ${STATUS[current.status]}` : "No split — you receive the full partner share"}</div>
            </div>
            <select aria-label="Split type" value={f.mode} onChange={(e) => setForm({ ...form, [g.id]: { ...f, mode: e.target.value as VenueSplitAgreement["mode"] } })} style={{ ...inputStyle, width: "auto" }}>
              <option value="percentage">Venue %</option>
              <option value="fixed_venue">Venue fixed €</option>
              <option value="fixed_host">Host fixed €</option>
            </select>
            <input aria-label="Split value" inputMode="decimal" placeholder={f.mode === "percentage" ? "e.g. 60" : "e.g. 15.00"} value={f.value} onChange={(e) => setForm({ ...form, [g.id]: { ...f, value: e.target.value } })} style={{ ...inputStyle, width: 110 }} />
            <Button onClick={() => propose(g)}>Propose to venue</Button>
          </div>
        );
      })}
      {error && <p role="alert" style={{ color: colors.danger, background: colors.dangerBg, padding: "8px 12px", borderRadius: radius.control, fontSize: 13, marginTop: 10 }}>{error}</p>}
    </Card>
  );
}
