import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  assignPartnerPlan,
  createCampaign,
  decideDisputeRecovery,
  enrollInCampaign,
  fetchAdmins,
  fetchConnectedAccounts,
  fetchTransfers,
  recoverPartnerBalance,
  runTransfersApi,
  type AdminConnectedAccount,
  type AdminTransfer,
  type TransferRunResult,
  fetchCampaigns,
  fetchDisputes,
  fetchFieldHelp,
  fetchLedgerBalances,
  fetchPartnerPlan,
  fetchPlansOverview,
  fetchRefunds,
  fetchSettlements,
  fetchWebhookEvents,
  issueAdminRefund,
  reconcileFees,
  replayWebhookEvent,
  runSettlementApi,
  setAdminRole,
  simulatePlans,
  simulatePrice,
  updateFieldHelp,
  type AdminAccount,
  type CampaignRow,
  type DisputeRow,
  type FieldHelpEntry,
  type LedgerBalance,
  type PlanComparison,
  type PlansOverview,
  type RefundRow,
  type SettlementRunResult,
  type SimulationResult,
  type WebhookEventRow,
} from "../api";
import { useAuth } from "../AuthContext";
import { irelandToday } from "../irelandDate";
import { colors, fonts, radius } from "../theme";
import { Button, ManageCard as Card, Modal, inputStyle, labelStyle, tableStyle, tdStyle, thStyle } from "./ui";

// Revenue & Connect Stage 3 — admin Finance (brief §18). Every number is the
// server's: this tab only displays and triggers. Every write asks for a
// reason (audited server-side). Sections are gated by the admin sub-role the
// server enforces anyway (finance/super for money; legal/super for help).

const euro = (minor: number | string) => {
  const n = Number(minor);
  return `${n < 0 ? "−" : ""}€${(Math.abs(n) / 100).toFixed(2)}`;
};
const h3: CSSProperties = { fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 6px" };
const hint: CSSProperties = { fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px", lineHeight: 1.5 };
const errStyle: CSSProperties = { color: colors.danger, fontSize: 13, background: colors.dangerBg, padding: "8px 12px", borderRadius: radius.control, margin: "10px 0 0" };
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", dateStyle: "medium", timeStyle: "short" }) : "—");
const toMinor = (text: string) => {
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

/** Asks for a reason, then runs the action; shows the server's error. */
function ReasonDialog({ title, note, confirm, danger, onClose, onConfirm }: { title: string; note?: string; confirm: string; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={note}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={busy || reason.trim().length < 5}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(reason.trim());
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : "That didn't work");
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirm}
          </Button>
        </div>
      }
    >
      <label style={{ display: "block" }}>
        <span style={labelStyle}>Reason (required, audited)</span>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
      </label>
      {error && <p style={errStyle}>{error}</p>}
    </Modal>
  );
}

// --- overview -----------------------------------------------------------------

function OverviewSection() {
  const [data, setData] = useState<{ balanced: boolean; accounts: LedgerBalance[] } | null>(null);
  const [fees, setFees] = useState<string | null>(null);
  const load = () => fetchLedgerBalances().then(setData).catch(() => setData(null));
  useEffect(() => {
    load();
  }, []);
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Ledger</h3>
      <p style={hint}>Balances from the append-only ledger (debits positive). Turn on "Financial ledger" in Commercial rules → Switches to start posting.</p>
      {!data ? (
        <p style={hint}>Loading…</p>
      ) : (
        <>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: data.balanced ? colors.greenText : colors.danger, margin: "0 0 10px" }}>
            {data.balanced ? "✓ The ledger balances (every entry nets to zero)" : "⚠ The ledger doesn't balance — investigate before any settlement"}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>Account</th><th style={thStyle}>Type</th><th style={thStyle}>Balance</th></tr></thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.account}><td style={tdStyle}>{a.name}</td><td style={tdStyle}>{a.accountType}</td><td style={{ ...tdStyle, fontWeight: 600 }}>{euro(a.balanceMinor)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={() => reconcileFees().then((r) => { setFees(`Reconciled ${r.reconciled} payment fees (${r.skipped} not yet available)`); load(); }).catch((e) => setFees(e instanceof Error ? e.message : "Failed"))}>
          Reconcile actual card fees
        </Button>
        {fees && <span style={{ fontSize: 12.5, color: colors.mutedLight }}>{fees}</span>}
      </div>
    </Card>
  );
}

// --- simulator ----------------------------------------------------------------

function SimulatorSection() {
  const [form, setForm] = useState({ price: "100", qty: "1", plan: "free", partnerKind: "", partnerId: "", funder: "none", discount: "10", share: "50", split: "none", venue: "35", gmv: "1500", orders: "40" });
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [cmp, setCmp] = useState<PlanComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const run = async () => {
    setError(null);
    const priceMinor = toMinor(form.price);
    if (priceMinor === null) return setError("Enter a price");
    const discount = toMinor(form.discount);
    try {
      const s = await simulatePrice({
        priceMinor,
        quantity: Math.max(1, Number(form.qty) || 1),
        planKey: form.partnerId ? undefined : (form.plan as "free" | "pro"),
        partnerKind: form.partnerId ? form.partnerKind || "org" : undefined,
        partnerId: form.partnerId || undefined,
        discounts: form.funder !== "none" && discount ? [{ funder: form.funder as "vendor", amountMinor: discount, platformShareBps: form.funder === "shared" ? Math.round(Number(form.share) * 100) : undefined }] : [],
        split: form.split === "fixed_venue" ? { mode: "fixed_venue", venueMinor: toMinor(form.venue) ?? 0 } : undefined,
      });
      setSim(s);
      const g = toMinor(form.gmv);
      if (g !== null) setCmp(await simulatePlans(g, Math.max(0, Number(form.orders) || 0)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    }
  };

  const r = sim?.result;
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Calculation simulator</h3>
      <p style={hint}>Prices any order with the same engine checkout uses, from the rules in force now. Enter a partner to use their plan and any partner-specific rates.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
        <Field label="Price (€)"><input value={form.price} onChange={set("price")} style={inputStyle} inputMode="decimal" /></Field>
        <Field label="Places"><input value={form.qty} onChange={set("qty")} style={inputStyle} inputMode="numeric" /></Field>
        <Field label="Plan (no partner)"><select value={form.plan} onChange={set("plan")} style={inputStyle}><option value="free">Free</option><option value="pro">Pro</option></select></Field>
        <Field label="Partner kind"><select value={form.partnerKind} onChange={set("partnerKind")} style={inputStyle}><option value="">—</option><option value="org">Organisation</option><option value="vendor">Vendor</option><option value="host">Host</option></select></Field>
        <Field label="Partner id"><input value={form.partnerId} onChange={set("partnerId")} style={inputStyle} placeholder="optional" /></Field>
        <Field label="Discount funded by"><select value={form.funder} onChange={set("funder")} style={inputStyle}><option value="none">No discount</option><option value="vendor">Partner</option><option value="helloCircle">HelloCircle</option><option value="shared">Shared</option></select></Field>
        {form.funder !== "none" && <Field label="Discount (€)"><input value={form.discount} onChange={set("discount")} style={inputStyle} inputMode="decimal" /></Field>}
        {form.funder === "shared" && <Field label="HelloCircle share (%)"><input value={form.share} onChange={set("share")} style={inputStyle} inputMode="decimal" /></Field>}
        <Field label="Split"><select value={form.split} onChange={set("split")} style={inputStyle}><option value="none">One partner</option><option value="fixed_venue">Venue fixed + host rest</option></select></Field>
        {form.split === "fixed_venue" && <Field label="Venue amount (€)"><input value={form.venue} onChange={set("venue")} style={inputStyle} inputMode="decimal" /></Field>}
        <Field label="Monthly sales (€)"><input value={form.gmv} onChange={set("gmv")} style={inputStyle} inputMode="decimal" /></Field>
        <Field label="Bookings / month"><input value={form.orders} onChange={set("orders")} style={inputStyle} inputMode="numeric" /></Field>
      </div>
      <div style={{ marginTop: 12 }}><Button onClick={run}>Simulate</Button></div>
      {error && <p style={errStyle}>{error}</p>}
      {r && (
        <div style={{ marginTop: 16 }} aria-live="polite">
          {!r.ok ? (
            <p style={errStyle}>{r.blockedReason}</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <tbody>
                  {[
                    ["Plan (fees from)", `${sim!.planKey} (${sim!.feePlanKey})`],
                    ["Customer pays", euro(r.customerChargeMinor)],
                    ["Fee base", euro(r.feeBaseMinor)],
                    [`Platform fee${r.minimumFeeApplied ? " (minimum)" : ""}`, euro(r.platformFeeNetMinor)],
                    ["VAT on platform fee", euro(r.platformFeeVatMinor)],
                    ["Partner pool", euro(r.partnerPoolMinor)],
                    ...r.allocations.map((a) => [`  → ${a.recipient}`, `${euro(a.amountMinor)} (payout est. ${euro(a.payoutEstimateMinor)})`]),
                    ["HelloCircle-funded discount", euro(r.helloCircleFundedDiscountMinor)],
                    ["Card cost estimate", euro(r.cardEstimateMinor)],
                    ["Contribution before reserves", euro(r.contributionBeforeReservesMinor)],
                    ["Contribution after reserves", euro(r.contributionMinor)],
                  ].map(([k, v]) => (
                    <tr key={k}><td style={tdStyle}>{k}</td><td style={{ ...tdStyle, fontWeight: 600 }}>{v}</td></tr>
                  ))}
                </tbody>
              </table>
              {r.marginWarning && <p style={errStyle}>⚠ Margin warning: HelloCircle's contribution on this order is below the configured threshold.</p>}
              <p style={{ ...hint, marginTop: 10 }}>Rule versions: {sim!.rules.map((x) => `${x.key} ${x.sources.map((s) => `${s.scopeType === "global" ? "global" : s.scopeId} v${s.version}`).join("+")}`).join(" · ")}</p>
            </div>
          )}
        </div>
      )}
      {cmp && (
        <p style={{ fontSize: 13.5, marginTop: 10 }}>
          Month of {euro(cmp.monthlyGmvMinor)} over {cmp.orders} bookings: Free fees {euro(cmp.free.feesMinor)}; Pro fees + subscription {euro(cmp.pro.feesMinor + cmp.pro.subscriptionMinor)}; cheaper: <strong>{cmp.cheaperPlan}</strong>.
          {cmp.proBreakEvenMonthlyGmvMinor !== null && <> Break-even {euro(cmp.proBreakEvenMonthlyGmvMinor)}.</>}
        </p>
      )}
    </Card>
  );
}

// --- settlements ----------------------------------------------------------------

function SettlementsSection() {
  const [runKey, setRunKey] = useState(() => `week-${irelandToday()}`);
  const [preview, setPreview] = useState<SettlementRunResult | null>(null);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchSettlements>>>([]);
  const [dialog, setDialog] = useState<null | "preview" | "run">(null);
  const load = () => fetchSettlements().then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Weekly settlement</h3>
      <p style={hint}>Releases completed orders (after the review period), then settles each partner at or above the minimum payout. Always preview first. No money moves until transfers are switched on.</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
        <Field label="Run key"><input value={runKey} onChange={(e) => setRunKey(e.target.value)} style={inputStyle} /></Field>
        <Button variant="ghost" onClick={() => setDialog("preview")}>Preview (dry run)</Button>
        <Button disabled={!preview || preview.runId === undefined} onClick={() => setDialog("run")}>Run settlement</Button>
      </div>
      {preview && (
        <p style={{ fontSize: 13.5, margin: "12px 0 0" }}>
          {preview.dryRun ? "Preview" : "Completed"}: {preview.released.length} orders released · {preview.settled.length} partners settled (
          {euro(preview.settled.reduce((a, s) => a + s.netMinor, 0))}) · {preview.carried.length} carried forward.
        </p>
      )}
      {rows.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={tableStyle}>
            <thead><tr><th style={thStyle}>Run</th><th style={thStyle}>Partner</th><th style={thStyle}>Amount</th><th style={thStyle}>Status</th><th style={thStyle}>When</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}><td style={tdStyle}>{s.runKey}</td><td style={tdStyle}>{s.partyType}:{s.partyId}</td><td style={{ ...tdStyle, fontWeight: 600 }}>{euro(s.netMinor)}</td><td style={tdStyle}>{s.status}</td><td style={tdStyle}>{when(s.createdAt)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && (
        <ReasonDialog
          title={dialog === "preview" ? "Preview settlement" : "Run settlement"}
          note={dialog === "run" ? "Creates settlements and posts them to the ledger. A run key can only complete once." : "Shows what would be released and settled. Nothing changes."}
          confirm={dialog === "preview" ? "Preview" : "Run"}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const r = await runSettlementApi({ runKey, dryRun: dialog === "preview", reason });
            setPreview(r);
            load();
          }}
        />
      )}
    </Card>
  );
}

// --- Stage 5a: transfers and connected accounts -----------------------------------------

function TransfersSection() {
  const [rows, setRows] = useState<AdminTransfer[]>([]);
  const [accounts, setAccounts] = useState<AdminConnectedAccount[]>([]);
  const [result, setResult] = useState<TransferRunResult | null>(null);
  const [dialog, setDialog] = useState<null | "preview" | "run" | { kind: string; id: string }>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = () => {
    fetchTransfers().then(setRows).catch(() => setRows([]));
    fetchConnectedAccounts().then(setAccounts).catch(() => setAccounts([]));
  };
  useEffect(load, []);
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Transfers to partners (Stripe Connect)</h3>
      <p style={hint}>
        Sends each "due" settlement to the partner's Stripe account. A partner is held until their payout account is verified and their trader details are self-certified. Turn on "Stripe Connect payouts" in Commercial rules → Switches first. Preview
        before running.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={() => setDialog("preview")}>Preview transfers</Button>
        <Button disabled={!result?.dryRun || result.transferred.length === 0} onClick={() => setDialog("run")}>Send transfers</Button>
      </div>
      {result && (
        <div style={{ fontSize: 13.5, margin: "12px 0 0" }} aria-live="polite">
          {result.dryRun ? "Preview" : "Done"}: {result.transferred.length} transfer(s), {euro(result.transferred.reduce((a, t) => a + t.amountMinor, 0))} · {result.held.length} held · {result.failed.length} failed
          {result.held.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, color: colors.textSoft }}>
              {result.held.slice(0, 10).map((h) => <li key={h.settlementId}>Settlement {h.settlementId}: {h.reasons.join("; ")}</li>)}
            </ul>
          )}
          {result.failed.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, color: colors.danger }}>
              {result.failed.map((f) => <li key={f.settlementId}>Settlement {f.settlementId}: {f.status === "unknown" ? "outcome not confirmed — run again to retry safely" : f.error}</li>)}
            </ul>
          )}
        </div>
      )}
      {message && <p style={{ fontSize: 13, margin: "10px 0 0" }}>{message}</p>}
      <h4 style={{ margin: "18px 0 8px", fontSize: 14 }}>Recent transfers</h4>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Settlement</th><th style={thStyle}>Partner</th><th style={thStyle}>Amount</th><th style={thStyle}>Status</th><th style={thStyle}>When</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td style={tdStyle}>#{t.settlementId} (try {t.attempt})</td>
                <td style={tdStyle}>{t.partyType}:{t.partyId}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{euro(t.amountMinor)}{Number(t.reversedMinor) > 0 ? ` (−${euro(t.reversedMinor)})` : ""}</td>
                <td style={{ ...tdStyle, color: t.status === "failed" || t.status === "unknown" ? colors.danger : colors.text }}>{t.status}{t.error ? ` — ${t.error}` : ""}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{when(t.createdAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td style={tdStyle} colSpan={5}>No transfers yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <h4 style={{ margin: "18px 0 8px", fontSize: 14 }}>Connected accounts</h4>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Partner</th><th style={thStyle}>Stripe account</th><th style={thStyle}>Status</th><th style={thStyle} /></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.accountId}>
                <td style={tdStyle}>{a.partyType}:{a.partyId}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{a.accountId} · {a.country}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{a.readiness.length ? a.readiness.join("; ") : "Ready"}</td>
                <td style={tdStyle}><Button variant="ghost" onClick={() => setDialog({ kind: a.partyType, id: a.partyId })}>Recover balance…</Button></td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td style={tdStyle} colSpan={4}>No partner has connected a payout account yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {dialog === "preview" || dialog === "run" ? (
        <ReasonDialog
          title={dialog === "preview" ? "Preview transfers" : "Send transfers"}
          note={dialog === "run" ? "Moves real money in Stripe (test mode until go-live). Each settlement is transferred at most once." : "Shows what would be sent and what is held. Nothing moves."}
          confirm={dialog === "preview" ? "Preview" : "Send"}
          danger={dialog === "run"}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            setResult(await runTransfersApi({ dryRun: dialog === "preview", reason }));
            load();
          }}
        />
      ) : dialog ? (
        <ReasonDialog
          title={`Recover ${dialog.kind}:${dialog.id}'s negative balance`}
          note="Reverses this partner's most recent transfers, up to what they owe (after a refund or a lost dispute they're responsible for). Audited."
          confirm="Reverse transfers"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const r = await recoverPartnerBalance(dialog.kind, dialog.id, reason);
            setMessage(`Recovered ${euro(r.recoveredMinor)}${r.unrecoveredMinor > 0 ? `; ${euro(r.unrecoveredMinor)} still owed (recovered from future settlements)` : ""}.`);
            load();
          }}
        />
      ) : null}
    </Card>
  );
}

// --- webhooks / refunds / disputes ---------------------------------------------------

function WebhooksSection() {
  const [status, setStatus] = useState("manual_review");
  const [rows, setRows] = useState<WebhookEventRow[]>([]);
  const [replay, setReplay] = useState<WebhookEventRow | null>(null);
  const load = () => fetchWebhookEvents(status || undefined).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, [status]);
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Payment events</h3>
      <p style={hint}>Every verified Stripe event, stored once. Failed events retry automatically; after five attempts (or when one can't be matched) they wait here for review.</p>
      <Field label="Show">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, maxWidth: 260 }}>
          <option value="manual_review">Needs review</option>
          <option value="failed">Failed (will retry)</option>
          <option value="processed">Processed</option>
          <option value="ignored">Stored, no action</option>
          <option value="">All</option>
        </select>
      </Field>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Received</th><th style={thStyle}>Event</th><th style={thStyle}>Status</th><th style={thStyle}>Error</th><th style={thStyle} /></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{when(e.receivedAt)}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{e.eventType}<div style={{ color: colors.mutedLight }}>{e.eventId}</div></td>
                <td style={tdStyle}>{e.status} ({e.attempts})</td>
                <td style={{ ...tdStyle, fontSize: 12.5, maxWidth: 280 }}>{e.lastError ?? ""}</td>
                <td style={tdStyle}>{(e.status === "failed" || e.status === "manual_review") && <Button variant="ghost" onClick={() => setReplay(e)}>Replay</Button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td style={tdStyle} colSpan={5}>Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
      {replay && <ReasonDialog title={`Replay ${replay.eventType}`} note="Re-fetches the event from Stripe and processes it again. Handlers are idempotent." confirm="Replay" onClose={() => setReplay(null)} onConfirm={async (reason) => { await replayWebhookEvent(replay.id, reason); load(); }} />}
    </Card>
  );
}

function RefundsSection() {
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [form, setForm] = useState({ sourceType: "booking", ref: "", amount: "", responsible: "platform" });
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const load = () => fetchRefunds().then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Refunds</h3>
      <p style={hint}>Full, partial or remaining refunds of any online order. Leave the amount empty to refund everything still refundable.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, alignItems: "end" }}>
        <Field label="Order type"><select value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })} style={inputStyle}>{["booking", "registration", "program", "experience", "game"].map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="Reference"><input value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value.trim() })} style={inputStyle} /></Field>
        <Field label="Amount (€, optional)"><input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} inputMode="decimal" /></Field>
        <Field label="Responsible"><select value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} style={inputStyle}><option value="platform">HelloCircle</option><option value="partner">Partner</option><option value="customer">Customer</option></select></Field>
        <Button disabled={!form.ref} onClick={() => setOpen(true)}>Refund…</Button>
      </div>
      {result && <p style={{ fontSize: 13, margin: "10px 0 0" }}>{result}</p>}
      <div style={{ overflowX: "auto", marginTop: 14 }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Order</th><th style={thStyle}>Amount</th><th style={thStyle}>Kind</th><th style={thStyle}>Origin</th><th style={thStyle}>Status</th><th style={thStyle}>Reason</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}><td style={tdStyle}>{r.source_type} {r.source_ref}</td><td style={{ ...tdStyle, fontWeight: 600 }}>{euro(r.amount_minor)}</td><td style={tdStyle}>{r.kind}</td><td style={tdStyle}>{r.origin}</td><td style={tdStyle}>{r.status}</td><td style={{ ...tdStyle, fontSize: 12.5 }}>{r.reason}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <ReasonDialog
          title={`Refund ${form.sourceType} ${form.ref}`}
          note={form.amount ? `Refund ${form.amount} euro of this order.` : "Refund everything still refundable on this order."}
          confirm="Refund"
          danger
          onClose={() => setOpen(false)}
          onConfirm={async (reason) => {
            const amountMinor = form.amount ? toMinor(form.amount) ?? undefined : undefined;
            const r = await issueAdminRefund({ sourceType: form.sourceType, ref: form.ref, amountMinor, reason, responsible: form.responsible as "platform" });
            setResult(`Refunded ${euro(r.amountMinor)}${r.full ? " — order fully refunded" : ""}.`);
            load();
          }}
        />
      )}
    </Card>
  );
}

function DisputesSection() {
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [decide, setDecide] = useState<{ row: DisputeRow; responsible: "partner" | "platform" } | null>(null);
  const load = () => fetchDisputes().then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Disputes</h3>
      <p style={hint}>When a dispute is lost, decide who bears it: a partner-caused loss is recovered from the partner's available balance; a platform-caused loss is absorbed by HelloCircle.</p>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Dispute</th><th style={thStyle}>Order</th><th style={thStyle}>Amount</th><th style={thStyle}>Status</th><th style={thStyle}>Recovery</th><th style={thStyle} /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{d.provider_dispute_id}<div style={{ color: colors.mutedLight }}>{d.reason}</div></td>
                <td style={tdStyle}>{d.source_type ? `${d.source_type} ${d.source_ref}` : "unmatched"}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{euro(d.amount_minor)}</td>
                <td style={tdStyle}>{d.status}</td>
                <td style={tdStyle}>{d.recovery_status}{d.responsible ? ` (${d.responsible})` : ""}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {d.status === "lost" && d.recovery_status === "pending" && (
                    <>
                      <Button variant="ghost" onClick={() => setDecide({ row: d, responsible: "partner" })}>Recover from partner</Button>{" "}
                      <Button variant="ghost" onClick={() => setDecide({ row: d, responsible: "platform" })}>HelloCircle absorbs</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td style={tdStyle} colSpan={6}>No disputes.</td></tr>}
          </tbody>
        </table>
      </div>
      {decide && <ReasonDialog title={decide.responsible === "partner" ? "Recover from the partner" : "HelloCircle absorbs the loss"} note="This decision is final and audited." confirm="Confirm" danger={decide.responsible === "partner"} onClose={() => setDecide(null)} onConfirm={async (reason) => { await decideDisputeRecovery(decide.row.id, decide.responsible, reason); load(); }} />}
    </Card>
  );
}

// --- plans, promotions, roles, help -------------------------------------------------

function PlansSection() {
  const [overview, setOverview] = useState<PlansOverview | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [partner, setPartner] = useState({ kind: "org", id: "", plan: "pro" });
  const [current, setCurrent] = useState<string | null>(null);
  const [campaignForm, setCampaignForm] = useState({ key: "founding-partners", days: "90", max: "30", commission: "free", ends: "" });
  const [enrol, setEnrol] = useState({ campaignId: "", kind: "org", id: "" });
  const [dialog, setDialog] = useState<null | "assign" | "campaign" | "enrol">(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = () => {
    fetchPlansOverview().then(setOverview).catch(() => setOverview(null));
    fetchCampaigns().then(setCampaigns).catch(() => setCampaigns([]));
  };
  useEffect(load, []);
  const pct = (bps: unknown) => `${Number(bps) / 100}%`;
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Plans and promotions</h3>
      {overview && (
        <p style={hint}>
          Free: {pct(overview.free.successFeeBps)} (min {euro(overview.free.minFeeMinor as number)}) · Pro: {euro(overview.pro.subscriptionMonthlyMinor as number)}/month, {pct(overview.pro.successFeeBps)} (min {euro(overview.pro.minFeeMinor as number)})
          {overview.proBreakEvenMonthlyGmvMinor !== null && <> · Pro break-even {euro(overview.proBreakEvenMonthlyGmvMinor)}/month</>}. Edit rates in Commercial rules.
        </p>
      )}
      <h4 style={{ margin: "8px 0", fontSize: 14 }}>Partner plan</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, alignItems: "end" }}>
        <Field label="Partner kind"><select value={partner.kind} onChange={(e) => setPartner({ ...partner, kind: e.target.value })} style={inputStyle}><option value="org">Organisation</option><option value="vendor">Vendor</option><option value="host">Host</option></select></Field>
        <Field label="Partner id"><input value={partner.id} onChange={(e) => setPartner({ ...partner, id: e.target.value.trim() })} style={inputStyle} /></Field>
        <Button variant="ghost" disabled={!partner.id} onClick={() => fetchPartnerPlan(partner.kind, partner.id).then((r) => setCurrent(`${r.current.planKey} (fees: ${r.current.feePlanKey}, ${r.current.source}${r.current.effectiveTo ? `, until ${when(r.current.effectiveTo)}` : ""})`)).catch((e) => setCurrent(e.message))}>Look up</Button>
        <Field label="Move to"><select value={partner.plan} onChange={(e) => setPartner({ ...partner, plan: e.target.value })} style={inputStyle}><option value="free">Free</option><option value="pro">Pro</option></select></Field>
        <Button disabled={!partner.id} onClick={() => setDialog("assign")}>Change plan…</Button>
      </div>
      {current && <p style={{ fontSize: 13, margin: "8px 0 0" }}>Current plan: {current}</p>}

      <h4 style={{ margin: "20px 0 8px", fontSize: 14 }}>Promotions</h4>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Campaign</th><th style={thStyle}>Benefit</th><th style={thStyle}>Commission on</th><th style={thStyle}>Enrolled</th><th style={thStyle}>Window</th></tr></thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}><td style={tdStyle}>{c.campaignKey} (#{c.id})</td><td style={tdStyle}>{c.planKey} for {c.benefitDays} days</td><td style={tdStyle}>{c.commissionPlanKey}</td><td style={tdStyle}>{c.enrolled}/{c.maxEnrollments}</td><td style={{ ...tdStyle, fontSize: 12.5 }}>{when(c.startsAt)} → {when(c.endsAt)}</td></tr>
            ))}
            {campaigns.length === 0 && <tr><td style={tdStyle} colSpan={5}>No campaigns yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, alignItems: "end", marginTop: 12 }}>
        <Field label="Key"><input value={campaignForm.key} onChange={(e) => setCampaignForm({ ...campaignForm, key: e.target.value })} style={inputStyle} /></Field>
        <Field label="Pro waived (days)"><input value={campaignForm.days} onChange={(e) => setCampaignForm({ ...campaignForm, days: e.target.value })} style={inputStyle} /></Field>
        <Field label="Max partners"><input value={campaignForm.max} onChange={(e) => setCampaignForm({ ...campaignForm, max: e.target.value })} style={inputStyle} /></Field>
        <Field label="Commission"><select value={campaignForm.commission} onChange={(e) => setCampaignForm({ ...campaignForm, commission: e.target.value })} style={inputStyle}><option value="free">Free rate</option><option value="pro">Pro rate</option></select></Field>
        <Field label="Enrolment closes"><input type="date" value={campaignForm.ends} onChange={(e) => setCampaignForm({ ...campaignForm, ends: e.target.value })} style={inputStyle} /></Field>
        <Button variant="ghost" disabled={!campaignForm.ends} onClick={() => setDialog("campaign")}>Create campaign…</Button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, alignItems: "end", marginTop: 12 }}>
        <Field label="Campaign #"><input value={enrol.campaignId} onChange={(e) => setEnrol({ ...enrol, campaignId: e.target.value })} style={inputStyle} /></Field>
        <Field label="Partner kind"><select value={enrol.kind} onChange={(e) => setEnrol({ ...enrol, kind: e.target.value })} style={inputStyle}><option value="org">Organisation</option><option value="vendor">Vendor</option><option value="host">Host</option></select></Field>
        <Field label="Partner id"><input value={enrol.id} onChange={(e) => setEnrol({ ...enrol, id: e.target.value.trim() })} style={inputStyle} /></Field>
        <Button variant="ghost" disabled={!enrol.campaignId || !enrol.id} onClick={() => setDialog("enrol")}>Enrol partner…</Button>
      </div>
      {message && <p style={{ fontSize: 13, margin: "10px 0 0" }}>{message}</p>}
      {dialog === "assign" && <ReasonDialog title={`Move ${partner.kind} ${partner.id} to ${partner.plan}`} note="Takes effect from now. Existing bookings keep their original fees." confirm="Change plan" onClose={() => setDialog(null)} onConfirm={async (reason) => { await assignPartnerPlan(partner.kind, partner.id, { planKey: partner.plan, reason }); setMessage("Plan changed."); }} />}
      {dialog === "campaign" && (
        <ReasonDialog
          title="Create campaign"
          note={`Pro subscription waived for ${campaignForm.days} days for up to ${campaignForm.max} partners; commission on the ${campaignForm.commission} rate.`}
          confirm="Create"
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await createCampaign({ campaignKey: campaignForm.key, planKey: "pro", commissionPlanKey: campaignForm.commission, benefitDays: Number(campaignForm.days), maxEnrollments: Number(campaignForm.max), startsAt: new Date().toISOString(), endsAt: new Date(`${campaignForm.ends}T23:59:59`).toISOString(), terms: `Pro subscription waived for ${campaignForm.days} days; commission charged at the ${campaignForm.commission} plan rate.`, reason });
            setMessage("Campaign created.");
            load();
          }}
        />
      )}
      {dialog === "enrol" && <ReasonDialog title="Enrol partner" confirm="Enrol" onClose={() => setDialog(null)} onConfirm={async (reason) => { await enrollInCampaign(Number(enrol.campaignId), { partnerKind: enrol.kind, partnerId: enrol.id, reason }); setMessage("Partner enrolled."); load(); }} />}
    </Card>
  );
}

function RolesSection() {
  const [admins, setAdmins] = useState<AdminAccount[] | null>(null);
  const [change, setChange] = useState<{ admin: AdminAccount; role: string } | null>(null);
  const load = () => fetchAdmins().then(setAdmins).catch(() => setAdmins(null));
  useEffect(() => {
    load();
  }, []);
  if (!admins) return null; // only super admins can list roles
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Admin roles</h3>
      <p style={hint}>Super: everything. Finance: money, rules, coupons. Support: moderation and support. Legal: policies and help content. Only a super admin changes roles; at least one super admin always remains.</p>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Admin</th><th style={thStyle}>Role</th></tr></thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id}>
                <td style={tdStyle}>{a.name || a.email}<div style={{ fontSize: 12, color: colors.mutedLight }}>{a.email}</div></td>
                <td style={tdStyle}>
                  <select value={a.adminRole} onChange={(e) => setChange({ admin: a, role: e.target.value })} style={{ ...inputStyle, maxWidth: 160 }} aria-label={`Role for ${a.email}`}>
                    {["super", "finance", "support", "legal"].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {change && <ReasonDialog title={`Make ${change.admin.email} ${change.role}`} confirm="Change role" onClose={() => { setChange(null); load(); }} onConfirm={async (reason) => { await setAdminRole(change.admin.id, change.role, reason); }} />}
    </Card>
  );
}

function HelpSection() {
  const [entries, setEntries] = useState<FieldHelpEntry[]>([]);
  const [edit, setEdit] = useState<FieldHelpEntry | null>(null);
  const [draft, setDraft] = useState<FieldHelpEntry | null>(null);
  const load = () => fetchFieldHelp().then(setEntries).catch(() => setEntries([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <Card style={{ padding: 22 }}>
      <h3 style={h3}>Field help</h3>
      <p style={hint}>The explanations behind every ⓘ on pricing and earnings screens. Each edit creates a new version.</p>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Field</th><th style={thStyle}>Definition</th><th style={thStyle}>Version</th><th style={thStyle} /></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.helpKey}><td style={tdStyle}>{e.name}</td><td style={{ ...tdStyle, fontSize: 12.5, maxWidth: 420 }}>{e.definition}</td><td style={tdStyle}>v{e.version}</td><td style={tdStyle}><Button variant="ghost" onClick={() => { setEdit(e); setDraft({ ...e }); }}>Edit</Button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && draft && (
        <Modal open size="wide" onClose={() => setEdit(null)} title={`Edit help: ${edit.name}`}>
          {(["name", "definition", "formula", "example", "whoPays", "whenCharged", "refundBehaviour", "policyKey"] as const).map((k) => (
            <label key={k} style={{ display: "block", marginBottom: 10 }}>
              <span style={labelStyle}>{k}</span>
              <textarea rows={k === "definition" ? 3 : 1} value={draft[k] as string} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} />
            </label>
          ))}
          <ReasonInline
            onSave={async (reason) => {
              const { helpKey: _k, version: _v, ...rest } = draft;
              await updateFieldHelp(edit.helpKey, { ...rest, reason });
              setEdit(null);
              load();
            }}
          />
        </Modal>
      )}
    </Card>
  );
}

function ReasonInline({ onSave }: { onSave: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
      <label style={{ flex: 1, minWidth: 220 }}>
        <span style={labelStyle}>Reason (required)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} />
      </label>
      <Button disabled={reason.trim().length < 5} onClick={() => onSave(reason.trim()).catch((e) => setError(e instanceof Error ? e.message : "Couldn't save"))}>Save new version</Button>
      {error && <p style={errStyle}>{error}</p>}
    </div>
  );
}

// --- the tab -------------------------------------------------------------------------

const SECTIONS = [
  { key: "overview", label: "Overview", roles: ["super", "finance"] },
  { key: "simulator", label: "Simulator", roles: ["super", "finance"] },
  { key: "settlements", label: "Settlements", roles: ["super", "finance"] },
  { key: "transfers", label: "Transfers", roles: ["super", "finance"] },
  { key: "events", label: "Payment events", roles: ["super", "finance"] },
  { key: "refunds", label: "Refunds", roles: ["super", "finance"] },
  { key: "disputes", label: "Disputes", roles: ["super", "finance"] },
  { key: "plans", label: "Plans & promotions", roles: ["super", "finance"] },
  { key: "help", label: "Field help", roles: ["super", "legal"] },
  { key: "roles", label: "Admin roles", roles: ["super"] },
] as const;

export function AdminFinanceTab() {
  const { user } = useAuth();
  const role = user?.adminRole ?? "super";
  const visible = SECTIONS.filter((s) => (s.roles as readonly string[]).includes(role));
  const [section, setSection] = useState<string>(visible[0]?.key ?? "help");
  if (!visible.length) return <p style={hint}>Your admin role doesn't include finance tools.</p>;
  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div role="tablist" aria-label="Finance sections" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {visible.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={section === s.key}
            onClick={() => setSection(s.key)}
            style={{ border: `1px solid ${section === s.key ? colors.green : colors.border}`, background: section === s.key ? colors.greenBg : "transparent", color: section === s.key ? colors.greenText : colors.text, borderRadius: 999, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            {s.label}
          </button>
        ))}
      </div>
      {section === "overview" && <OverviewSection />}
      {section === "simulator" && <SimulatorSection />}
      {section === "settlements" && <SettlementsSection />}
      {section === "transfers" && <TransfersSection />}
      {section === "events" && <WebhooksSection />}
      {section === "refunds" && <RefundsSection />}
      {section === "disputes" && <DisputesSection />}
      {section === "plans" && <PlansSection />}
      {section === "help" && <HelpSection />}
      {section === "roles" && <RolesSection />}
    </div>
  );
}
