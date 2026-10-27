import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Receipt as ReceiptIcon, SearchX } from "lucide-react";
import { fetchReceipts } from "../../api";
import { RECEIPT_KIND_LABELS, receiptListStatus } from "../../components/commerceDisplay";
import { ToneChip } from "../../components/ReceiptDrawer";
import { Button, LoadErrorState, RowSkeleton, inputStyle } from "../../components/ui";
import { euro } from "../../euro";
import type { Receipt } from "../../types";
import { useUrlParam } from "../../useUrlTab";
import { AccountEmpty, AccountPage, SearchField, dateLong } from "./accountUi";

// Receipts — the amount actually charged per paid participation, with the
// server's payment status (paid / refunded / failed / pending) shown as-is:
// a booking's own status never stands in for a payment status here.

const PERIODS = [
  { key: "all", label: "All time" },
  { key: "30", label: "Last 30 days" },
  { key: "365", label: "Last 12 months" },
];

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Earlier" : d.toLocaleDateString("en-IE", { month: "long", year: "numeric" });
}

export function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useUrlParam<string>("q", "");
  const [status, setStatus] = useUrlParam<string>("status", "all");
  const [period, setPeriod] = useUrlParam<string>("period", "all");

  const load = () => {
    setFailed(false);
    setReceipts(null);
    fetchReceipts().then(setReceipts).catch(() => setFailed(true));
  };
  useEffect(load, []);

  const all = receipts ?? [];
  const statuses = useMemo(() => [...new Set(all.map((r) => receiptListStatus(r.paymentStatus).label))], [all]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const since = period === "all" ? 0 : Date.now() - Number(period) * 86_400_000;
    return all.filter(
      (r) =>
        (status === "all" || receiptListStatus(r.paymentStatus).label === status) &&
        (since === 0 || new Date(r.createdAt).getTime() >= since) &&
        (!needle || `${r.label} ${r.ref} ${RECEIPT_KIND_LABELS[r.kind]}`.toLowerCase().includes(needle))
    );
  }, [all, q, status, period]);

  const groups = useMemo(() => {
    const out: { label: string; items: Receipt[] }[] = [];
    for (const r of [...shown].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const label = monthLabel(r.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(r);
      else out.push({ label, items: [r] });
    }
    return out;
  }, [shown]);

  const filtering = q.trim() !== "" || status !== "all" || period !== "all";

  return (
    <AccountPage eyebrow="My Life" title="Receipts" lede="Everything you've paid for, with the amount charged and any refunds.">
      {failed ? (
        <LoadErrorState title="We couldn't load your receipts." onRetry={load} />
      ) : receipts === null ? (
        <div style={{ marginTop: 24 }}><RowSkeleton /></div>
      ) : receipts.length === 0 ? (
        <AccountEmpty icon={<ReceiptIcon size={20} aria-hidden="true" />} title="No payments yet">
          When you pay for a booking, registration, pass or ticket, the receipt will be here.
        </AccountEmpty>
      ) : (
        <>
          <div className="acct-toolbar">
            <SearchField value={q} onChange={setQ} label="Search receipts" placeholder="Search by name or reference" />
            <label className="acct-sr" htmlFor="rcpt-status">Payment status</label>
            <select id="rcpt-status" className="acct-select" value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
              <option value="all">Any status</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <label className="acct-sr" htmlFor="rcpt-period">Date</label>
            <select id="rcpt-period" className="acct-select" value={period} onChange={(e) => setPeriod(e.target.value)} style={inputStyle}>
              {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          {shown.length === 0 ? (
            <AccountEmpty icon={<SearchX size={20} aria-hidden="true" />} title="No receipts match" action={filtering ? <Button variant="ghost" onClick={() => { setQ(""); setStatus("all"); setPeriod("all"); }}>Show all receipts</Button> : undefined} />
          ) : (
            groups.map((g) => (
              <section key={g.label} aria-label={g.label}>
                <h2 className="acct-group-label">{g.label}</h2>
                <ul className="acct-list">
                  {g.items.map((r) => {
                    const st = receiptListStatus(r.paymentStatus);
                    return (
                      <li key={r.ref} className="acct-item">
                        <Link
                          to={`/receipts/${encodeURIComponent(r.ref)}`}
                          className="acct-item-main"
                          aria-label={`${r.label}, ${euro(r.totalCents / 100)}, ${st.label}, ${dateLong(r.createdAt)}`}
                        >
                          <span className="acct-thumb" aria-hidden="true"><ReceiptIcon size={18} /></span>
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span className="acct-item-title" style={{ display: "block" }}>{r.label}</span>
                            <span className="acct-item-meta" style={{ display: "block" }}>
                              {RECEIPT_KIND_LABELS[r.kind]} · {dateLong(r.createdAt)} · <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>{r.ref}</span>
                            </span>
                          </span>
                          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flex: "none" }}>
                            <span style={{ fontWeight: 700, fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{euro(r.totalCents / 100)}</span>
                            <ToneChip tone={st.tone}>{st.label}</ToneChip>
                          </span>
                          <ChevronRight size={18} aria-hidden="true" style={{ color: "var(--color-faint)", flex: "none" }} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
          <p className="acct-row-desc" style={{ marginTop: 24 }}>Open a receipt to see the full breakdown, print it or save it as a PDF.</p>
        </>
      )}
    </AccountPage>
  );
}
