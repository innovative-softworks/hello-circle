import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Ticket } from "lucide-react";
import { fetchMyPasses } from "../../api";
import { Button, LoadErrorState, RowSkeleton } from "../../components/ui";
import { euro } from "../../euro";
import type { Pass } from "../../types";
import { AccountEmpty, AccountPage, AccountSection, Note, StatusTag, dateLong, type Tone } from "./accountUi";

type PassState = "active" | "used" | "expired";

function passState(p: Pass, now = Date.now()): PassState {
  if (p.expiresAt && new Date(p.expiresAt).getTime() < now) return "expired";
  if (p.creditsUsed >= p.creditsTotal) return "used";
  return "active";
}

const STATE_TAG: Record<PassState, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "ok" },
  used: { label: "All used", tone: "muted" },
  expired: { label: "Expired", tone: "muted" },
};

function PassRow({ p }: { p: Pass }) {
  const st = passState(p);
  const left = Math.max(0, p.creditsTotal - p.creditsUsed);
  const pct = p.creditsTotal > 0 ? Math.round((left / p.creditsTotal) * 100) : 0;
  const expiresSoon = st === "active" && p.expiresAt && new Date(p.expiresAt).getTime() - Date.now() < 14 * 86_400_000;
  return (
    <li className="acct-item" data-muted={st !== "active" ? "true" : undefined} style={{ alignItems: "flex-start" }}>
      <span className="acct-thumb" aria-hidden="true"><Ticket size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link to={`/clubs/${p.listingId}`} className="acct-item-title" style={{ textDecoration: "none" }}>{p.listingName}</Link>
        <div className="acct-item-meta">
          {left} of {p.creditsTotal} {p.creditsTotal === 1 ? "credit" : "credits"} left · Paid {euro(p.purchasedCents / 100)}
        </div>
        {st === "active" && (
          <div className="acct-meter" role="img" aria-label={`${left} of ${p.creditsTotal} credits left`}>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="acct-item-meta" style={{ marginTop: 6 }}>
          {p.expiresAt ? `${st === "expired" ? "Expired" : "Use by"} ${dateLong(p.expiresAt)}` : "No expiry date"}
        </div>
      </div>
      <div className="acct-item-side">
        {expiresSoon && <StatusTag tone="warn">Expires soon</StatusTag>}
        <StatusTag tone={STATE_TAG[st].tone}>{STATE_TAG[st].label}</StatusTag>
      </div>
    </li>
  );
}

export function PassesPage() {
  const navigate = useNavigate();
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    setPasses(null);
    fetchMyPasses().then(setPasses).catch(() => setFailed(true));
  };
  useEffect(load, []);

  const active = (passes ?? []).filter((p) => passState(p) === "active");
  const past = (passes ?? []).filter((p) => passState(p) !== "active");

  return (
    <AccountPage eyebrow="My Life" title="Passes" lede="Credit packs you've bought from clubs, and how many sessions are left on each.">
      {failed ? (
        <LoadErrorState title="We couldn't load your passes." onRetry={load} />
      ) : passes === null ? (
        <div style={{ marginTop: 24 }}><RowSkeleton /></div>
      ) : passes.length === 0 ? (
        <AccountEmpty icon={<Ticket size={20} aria-hidden="true" />} title="No passes yet" action={<Button variant="ghost" onClick={() => navigate("/browse/clubs")}>Browse clubs <ArrowRight size={15} aria-hidden="true" /></Button>}>
          Some clubs sell a pack of session credits. Buy one from the club's page and it will show here.
        </AccountEmpty>
      ) : (
        <>
          <AccountSection title="Active" description={active.length === 0 ? "None right now." : undefined}>
            {active.length > 0 && <ul className="acct-list">{active.map((p) => <PassRow key={p.id} p={p} />)}</ul>}
          </AccountSection>
          {past.length > 0 && (
            <AccountSection title="Used up or expired">
              <ul className="acct-list">{past.map((p) => <PassRow key={p.id} p={p} />)}</ul>
            </AccountSection>
          )}
          <AccountSection>
            <Note>When you register for a session at the club, you can pay with a credit instead of a card. Payments for passes are in Receipts.</Note>
          </AccountSection>
        </>
      )}
    </AccountPage>
  );
}
