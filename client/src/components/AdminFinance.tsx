import { useAdminCan } from "./admin/adminPermissions";
import { AlertTriangle, ArrowLeftRight, CircleQuestionMark, UserCog, Award, BadgePercent, BookOpen, Calculator, FlaskConical, Gavel, Landmark, LayoutDashboard, PiggyBank, Receipt, TicketPercent, Undo2, Wallet, Zap, type LucideIcon } from "lucide-react";
import { AdminButton, AdminModal, AttentionBanner, IconTabs, IconTile } from "./admin/adminUi";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  adjustPartnerPoints,
  fetchAdminRewardHistory,
  fetchAdminRewards,
  fetchBankPayouts,
  fetchCouponUsage,
  fetchCreditSummary,
  type AdminBankPayout,
  type AdminCouponUsage,
  type AdminCreditSummary,
  type AdminRewardRow,
  assignPartnerPlan,
  createCampaign,
  enrollInCampaign,
  fetchAdmins,
  fetchConnectedAccounts,
  fetchResidentCredits,
  fetchSubscriptions,
  grantResidentCredit,
  sweepSubscriptionsApi,
  type AdminSubscription,
  fetchTransfers,
  fetchPartnerDebts,
  openPartnerDebt,
  retryPartnerDebt,
  type PartnerDebt,
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
  fetchPaymentReviews,
  issueAdminRefund,
  reconcileFees,
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
  type PaymentReviewRow,
} from "../api";
import { useAuth } from "../AuthContext";
import { LoadFailed, useLoadFailure } from "./admin/loadFailure";
import { FinanceRecordPage, HOLD_LABEL, REVIEW_REASON, bookingState } from "./admin/FinanceRecords";
import { useRecordParam, useUrlParam } from "../useUrlTab";
import { HYPOTHETICAL_PLAN_MODEL_NOTE } from "../partnerPricing";
import { irelandToday } from "../irelandDate";
import { colors, fonts, radius } from "../theme";
import { Button, ManageCard as Card, Modal, inputStyle, labelStyle, tableStyle, tdStyle, thStyle, StackTable } from "./ui";

// Revenue & Connect Stage 3 — admin Finance (brief §18). Every number is the
// server's: this tab only displays and triggers. Every write asks for a
// reason (audited server-side). Sections are gated by the admin sub-role the
// server enforces anyway (finance/super for money; legal/super for help).

const euro = (minor: number | string) => {
  const n = Number(minor);
  return `${n < 0 ? "−" : ""}€${(Math.abs(n) / 100).toFixed(2)}`;
};
const h3: CSSProperties = { fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 6px" };
/** Panel heading with an icon tile (2026-10-16 icon pass). */
function CardTitle({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
      <IconTile icon={icon} />
      <h3 style={{ ...h3, margin: 0 }}>{children}</h3>
    </div>
  );
}
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
        <span style={labelStyle}>
          Reason <span aria-hidden="true">*</span>
        </span>
        <textarea rows={3} required aria-describedby="finance-reason-hint" value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
      </label>
      <p id="finance-reason-hint" style={{ ...hint, margin: "4px 0 0" }}>Required, at least 5 characters. Saved in the audit log.</p>
      {error && <p role="alert" style={errStyle}>{error}</p>}
    </Modal>
  );
}



// --- overview -----------------------------------------------------------------

function OverviewSection() {
  const { failed, track } = useLoadFailure();
  const [data, setData] = useState<{ balanced: boolean; accounts: LedgerBalance[] } | null>(null);
  const [fees, setFees] = useState<string | null>(null);
  const load = () => track(fetchLedgerBalances(), setData);
  useEffect(() => {
    load();
  }, []);
  return (
    <>
    <Card style={{ padding: 22 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 6 }}>
        <IconTile icon={BookOpen} tone="good" />
        <h3 style={{ ...h3, margin: 0 }}>Ledger</h3>
      </div>
      <LoadFailed failed={failed} onRetry={load} />
      <p style={hint}>Balances from the append-only ledger (debits positive). The ledger only posts while the "Financial ledger" switch is on in Commercial rules.</p>
      {!data ? (
        !failed && <p style={hint}>Loading…</p>
      ) : (
        <>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: data.balanced ? colors.greenText : colors.danger, margin: "0 0 10px" }}>
            {data.balanced ? "✓ The ledger balances (every entry nets to zero)" : "⚠ The ledger doesn't balance — investigate before any settlement"}
          </p>
          <div style={{ overflowX: "auto" }}>
            <StackTable>
              <thead><tr><th style={thStyle}>Account</th><th style={thStyle}>Type</th><th style={thStyle}>Balance</th></tr></thead>
              <tbody>
                {data.accounts.length === 0 && (
                  <tr>
                    <td style={tdStyle} colSpan={3}>
                      No ledger entries yet.
                    </td>
                  </tr>
                )}
                {data.accounts.map((a) => (
                  <tr key={a.account}><td style={tdStyle}>{a.name}</td><td style={tdStyle}>{a.accountType}</td><td style={{ ...tdStyle, fontWeight: 600 }}>{euro(a.balanceMinor)}</td></tr>
                ))}
              </tbody>
            </StackTable>
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
    </>
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
      <CardTitle icon={FlaskConical}>Calculation simulator (hypothetical)</CardTitle>
      <p role="note" style={{ ...hint, background: colors.orangeBg, color: colors.orangeDark, padding: "10px 12px", borderRadius: radius.control, fontWeight: 600 }} data-testid="simulator-hypothetical">
        {HYPOTHETICAL_PLAN_MODEL_NOTE}
      </p>
      <p style={hint}>Prices a scenario with the plan model from the plan rules in force now. Enter a partner to use their plan and any partner-specific rates.</p>
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
              <StackTable>
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
              </StackTable>
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

function SettlementsSection({ onOpen }: { onOpen: (key: string) => void }) {
  const { failed, track } = useLoadFailure();
  const [runKey, setRunKey] = useState(() => `week-${irelandToday()}`);
  const [preview, setPreview] = useState<SettlementRunResult | null>(null);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchSettlements>>>([]);
  const [dialog, setDialog] = useState<null | "preview" | "run">(null);
  const load = () => track(fetchSettlements(), setRows);
  useEffect(() => {
    load();
  }, []);
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={Calculator}>Weekly settlement</CardTitle>
      <LoadFailed failed={failed} onRetry={load} />
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
          <StackTable>
            <thead><tr><th style={thStyle}>Run</th><th style={thStyle}>Partner</th><th style={thStyle}>Amount</th><th style={thStyle}>Settlement</th><th style={thStyle}>When</th><th style={thStyle}><span className="adm-visually-hidden">Open</span></th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}><td style={tdStyle}>{s.runKey}</td><td style={tdStyle}>{s.partyType}:{s.partyId}</td><td style={{ ...tdStyle, fontWeight: 600 }}>{euro(s.netMinor)}</td><td style={tdStyle}>{s.status}</td><td style={tdStyle}>{when(s.createdAt)}</td><td style={tdStyle}><Button variant="ghost" onClick={() => onOpen(`settlement:${s.id}`)} aria-label={`Open settlement ${s.id}`}>Open</Button></td></tr>
              ))}
            </tbody>
          </StackTable>
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

function TransfersSection({ onOpen }: { onOpen: (key: string) => void }) {
  const { failed, track } = useLoadFailure();
  const [rows, setRows] = useState<AdminTransfer[]>([]);
  const [accounts, setAccounts] = useState<AdminConnectedAccount[]>([]);
  const [result, setResult] = useState<TransferRunResult | null>(null);
  const [dialog, setDialog] = useState<null | "preview" | "run" | { kind: string; id: string }>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = () => {
    track(fetchTransfers(), setRows);
    track(fetchConnectedAccounts(), setAccounts);
  };
  useEffect(load, []);
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={ArrowLeftRight}>Transfers to partners (Stripe Connect)</CardTitle>
      <LoadFailed failed={failed} onRetry={load} />
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
        <StackTable>
          <thead><tr><th style={thStyle}>Settlement</th><th style={thStyle}>Partner</th><th style={thStyle}>Amount</th><th style={thStyle}>Status</th><th style={thStyle}>When</th><th style={thStyle} /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td style={tdStyle}>#{t.settlementId} (try {t.attempt})</td>
                <td style={tdStyle}>{t.partyType}:{t.partyId}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{euro(t.amountMinor)}{Number(t.reversedMinor) > 0 ? ` (−${euro(t.reversedMinor)})` : ""}</td>
                <td style={{ ...tdStyle, color: t.status === "failed" || t.status === "unknown" ? colors.danger : colors.text }}>{t.status}{t.error ? ` — ${t.error}` : ""}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{when(t.createdAt)}</td>
                <td style={tdStyle}><Button variant="ghost" onClick={() => onOpen(`transfer:${t.id}`)} aria-label={`Open transfer ${t.id}`}>Open</Button></td>
              </tr>
            ))}
            {rows.length === 0 && !failed && <tr><td style={tdStyle} colSpan={6}>No transfers yet.</td></tr>}
          </tbody>
        </StackTable>
      </div>
      <h4 style={{ margin: "18px 0 8px", fontSize: 14 }}>Connected accounts</h4>
      <div style={{ overflowX: "auto" }}>
        <StackTable>
          <thead><tr><th style={thStyle}>Partner</th><th style={thStyle}>Stripe account</th><th style={thStyle}>Status</th><th style={thStyle} /></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.accountId}>
                <td style={tdStyle}>{a.partyType}:{a.partyId}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{a.accountId} · {a.country}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{a.readiness.length ? a.readiness.join("; ") : "Ready"}</td>
                <td style={tdStyle}><Button variant="ghost" onClick={() => setDialog({ kind: a.partyType, id: a.partyId })}>Open partner debt…</Button></td>
              </tr>
            ))}
            {accounts.length === 0 && !failed && <tr><td style={tdStyle} colSpan={4}>No partner has connected a payout account yet.</td></tr>}
          </tbody>
        </StackTable>
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
          title={`Open a debt for ${dialog.kind}:${dialog.id}`}
          note="For what this partner owes back (a refund after transfer, or a lost dispute they're responsible for). Their earnings are frozen, their own most recent transfer allocations are reversed up to the amount owed, and anything not recovered is offset against their future earnings. Never another partner's money. Audited (reason at least 10 characters)."
          confirm="Open debt and recover"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const r = await openPartnerDebt(dialog.kind, dialog.id, reason);
            setMessage(`Debt #${r.debtId}: recovered ${euro(r.recoveredMinor)}${r.unrecoveredMinor > 0 ? `; ${euro(r.unrecoveredMinor)} still owed (frozen until recovered or offset)` : " — fully recovered"}.`);
            load();
          }}
        />
      ) : null}
    </Card>
  );
}

function DebtsSection() {
  const { failed, track } = useLoadFailure();
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState<PartnerDebt[]>([]);
  const [retry, setRetry] = useState<PartnerDebt | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = () => track(fetchPartnerDebts(status || undefined), setRows);
  useEffect(() => {
    load();
  }, [status]);
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={Receipt}>Partner debts</CardTitle>
      <LoadFailed failed={failed} onRetry={load} />
      <p style={hint}>
        What partners owe back after a refund or chargeback that came after their transfer. While a debt is open the partner's earnings are frozen. It closes when recovered by reversing that partner's own transfers, or offset by their own new earnings.
      </p>
      <Field label="Show">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, maxWidth: 220 }}>
          <option value="open">Open</option>
          <option value="recovered">Recovered</option>
          <option value="offset">Offset by earnings</option>
          <option value="">All</option>
        </select>
      </Field>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <StackTable>
          <thead><tr><th style={thStyle}>Debt</th><th style={thStyle}>Partner</th><th style={thStyle}>Owed</th><th style={thStyle}>Recovered</th><th style={thStyle}>Offset</th><th style={thStyle}>Outstanding</th><th style={thStyle}>Reason</th><th style={thStyle} /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td style={tdStyle}>#{d.id} · {d.status}</td>
                <td style={tdStyle}>{d.partyType}:{d.partyId}</td>
                <td style={tdStyle}>{euro(d.openedMinor)}</td>
                <td style={tdStyle}>{euro(d.recoveredMinor)}</td>
                <td style={tdStyle}>{euro(d.offsetMinor)}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: d.outstandingMinor > 0 ? colors.danger : colors.text }}>{euro(d.outstandingMinor)}</td>
                <td style={{ ...tdStyle, fontSize: 12.5, maxWidth: 260 }}>{d.reason}</td>
                <td style={tdStyle}>{d.status === "open" && <Button variant="ghost" onClick={() => setRetry(d)}>Retry recovery…</Button>}</td>
              </tr>
            ))}
            {rows.length === 0 && !failed && <tr><td style={tdStyle} colSpan={8}>Nothing here.</td></tr>}
          </tbody>
        </StackTable>
      </div>
      {message && <p style={{ fontSize: 13, margin: "10px 0 0" }}>{message}</p>}
      {retry && (
        <ReasonDialog
          title={`Retry recovery of debt #${retry.id}`}
          confirm="Retry"
          onClose={() => setRetry(null)}
          onConfirm={async (reason) => {
            const r = await retryPartnerDebt(retry.id, reason);
            setMessage(`Recovered ${euro(r.recoveredMinor)}; still owed ${euro(r.unrecoveredMinor)}.`);
            load();
          }}
        />
      )}
    </Card>
  );
}

// --- Stage 5b: customer credits and Pro subscriptions ------------------------------------

function CreditsProSection() {
  const { failed, track } = useLoadFailure();
  const [email, setEmail] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const [amount, setAmount] = useState("10");
  const [kind, setKind] = useState<"goodwill" | "promotional" | "refund">("goodwill");
  const [funding, setFunding] = useState<"helloCircle" | "partner">("helloCircle");
  const [expiry, setExpiry] = useState("");
  const [grantKey, setGrantKey] = useState("");
  const [summary, setSummary] = useState<AdminCreditSummary | null>(null);
  const [lookup, setLookup] = useState<Awaited<ReturnType<typeof fetchResidentCredits>> | null>(null);
  const [subs, setSubs] = useState<AdminSubscription[]>([]);
  const [dialog, setDialog] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const loadSubs = () => track(fetchSubscriptions(), setSubs);
  const loadSummary = () => track(fetchCreditSummary(), setSummary);
  useEffect(() => {
    loadSubs();
    loadSummary();
  }, []);
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={PiggyBank}>Customer credits</CardTitle>
      <LoadFailed failed={failed} onRetry={() => { loadSubs(); loadSummary(); }} />
      <p style={hint}>HelloCircle-funded credit a resident can use at checkout (engine-priced bookings). No cash value; expires as set in Commercial rules → Customer credits. Turn on "Customer credits" in Switches first.</p>
      {/* Lookup stays on the page; granting opens a form popup (2026-10-16). */}
      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <Field label="Find a resident's credit"><input type="email" value={lookupEmail} onChange={(e) => setLookupEmail(e.target.value.trim())} placeholder="name@example.com" style={inputStyle} /></Field>
        </div>
        <Button variant="ghost" disabled={!lookupEmail} onClick={() => fetchResidentCredits(lookupEmail).then(setLookup).catch((e) => setMessage(e instanceof Error ? e.message : "Not found"))}>Look up</Button>
        <Button onClick={() => { setEmail(lookupEmail); setGrantOpen(true); }}>New credit grant</Button>
      </div>
      <AdminModal
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        title="Grant customer credit"
        subtitle="No cash value. The resident can use it at checkout on engine-priced bookings."
        footer={
          <>
            <AdminButton variant="quiet" onClick={() => setGrantOpen(false)}>
              Cancel
            </AdminButton>
            <AdminButton variant="primary" disabled={!email || toMinor(amount) === null} onClick={() => { setGrantKey(`grant-${crypto.randomUUID()}`); setGrantOpen(false); setDialog(true); }}>
              Grant credit…
            </AdminButton>
          </>
        }
      >
      <div className="adm-dlg-grid">
        <Field label="Resident email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} style={inputStyle} /></Field>
        <Field label="Amount (€)"><input value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} inputMode="decimal" /></Field>
        <Field label="Currency"><input value="EUR" readOnly aria-readonly style={inputStyle} /></Field>
        <Field label="Credit type">
          <select value={kind} onChange={(e) => setKind(e.target.value as "goodwill")} style={inputStyle}>
            <option value="goodwill">Goodwill</option>
            <option value="promotional">Promotional</option>
            <option value="refund">Refund as credit</option>
          </select>
        </Field>
        <Field label="Funded by">
          <select value={funding} onChange={(e) => setFunding(e.target.value as "helloCircle")} style={inputStyle}>
            <option value="helloCircle">HelloCircle</option>
            <option value="partner">Partner</option>
          </select>
        </Field>
        <Field label="Expires (optional)"><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} style={inputStyle} /></Field>
      </div>
      </AdminModal>
      {lookup && <p style={{ fontSize: 13.5, margin: "10px 0 0" }}>Balance {euro(lookup.balanceMinor)} across {lookup.lots.length} grant(s).</p>}
      {message && <p style={{ fontSize: 13, margin: "10px 0 0" }}>{message}</p>}
      {dialog && (
        <ReasonDialog
          title={`Grant €${amount} of ${kind} credit to ${email}, funded by ${funding === "helloCircle" ? "HelloCircle" : "the partner"}${expiry ? `, expiring ${expiry}` : ""}`}
          confirm="Grant"
          onClose={() => setDialog(false)}
          onConfirm={async (reason) => {
            // One idempotency key per dialog: a double submit grants once.
            const r = await grantResidentCredit({ email, amountMinor: toMinor(amount) ?? 0, kind, reason, fundingOwner: funding, expiresAt: expiry || null /* end of that day in Ireland, set by the server */, idempotencyKey: grantKey });
            setMessage(r.duplicate ? "Already granted (duplicate submission ignored)." : `Granted. Expires ${when(r.expiresAt)}.`);
            setLookup(await fetchResidentCredits(email));
            loadSummary();
          }}
        />
      )}
      {summary && (
        <>
          <h3 style={{ ...h3, marginTop: 24 }}>Credit outstanding</h3>
          <p style={{ fontSize: 13.5, margin: "0 0 8px" }} data-testid="credit-outstanding">{euro(summary.outstandingMinor)} across {summary.residents} resident(s).</p>
          <div style={{ overflowX: "auto" }}>
            <StackTable>
              <thead><tr><th style={thStyle}>Resident</th><th style={thStyle}>Type</th><th style={thStyle}>Funded by</th><th style={thStyle}>Granted</th><th style={thStyle}>Left</th><th style={thStyle}>Expires</th></tr></thead>
              <tbody>
                {summary.grants.slice(0, 20).map((g) => (
                  <tr key={g.id}>
                    <td style={tdStyle}>{g.email ?? "—"}</td>
                    <td style={tdStyle}>{g.kind}</td>
                    <td style={tdStyle}>{g.fundingOwner === "partner" ? "Partner" : "HelloCircle"}</td>
                    <td style={tdStyle}>{euro(g.amountMinor)} {g.currency}</td>
                    <td style={tdStyle}>{euro(g.remainingMinor)}</td>
                    <td style={{ ...tdStyle, fontSize: 12.5 }}>{when(g.expiresAt)}</td>
                  </tr>
                ))}
                {summary.grants.length === 0 && <tr><td style={tdStyle} colSpan={6}>No credit granted yet.</td></tr>}
              </tbody>
            </StackTable>
          </div>
        </>
      )}
      <h3 style={{ ...h3, marginTop: 24 }}>Pro subscriptions</h3>
      <p style={hint}>Stripe Billing subscriptions. A failed payment gets the grace period set in Commercial rules → Pro pricing before Pro ends (checked hourly — or now with the button). "duplicate" = a second checkout cancelled on arrival; refund its first payment if one was taken.</p>
      <Button variant="ghost" onClick={() => sweepSubscriptionsApi().then((r) => { setMessage(`Grace check: ${r.ended} subscription(s) ended.`); loadSubs(); })}>Run grace check now</Button>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <StackTable>
          <thead><tr><th style={thStyle}>Partner</th><th style={thStyle}>Status</th><th style={thStyle}>Price</th><th style={thStyle}>Period ends</th><th style={thStyle}>Grace until</th></tr></thead>
          <tbody>
            {subs.map((x) => (
              <tr key={x.id}>
                <td style={tdStyle}>{x.partyType}:{x.partyId}</td>
                <td style={{ ...tdStyle, color: x.status === "past_due" ? colors.danger : colors.text }}>{x.status}{x.cancelAtPeriodEnd ? " (cancelling)" : ""}</td>
                <td style={tdStyle}>{euro(x.grossMinor)}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{when(x.currentPeriodEnd)}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{when(x.graceUntil)}</td>
              </tr>
            ))}
            {subs.length === 0 && !failed && <tr><td style={tdStyle} colSpan={5}>No subscriptions yet.</td></tr>}
          </tbody>
        </StackTable>
      </div>
    </Card>
  );
}

// --- Stage 5f: reward points, coupons, bank payouts -----------------------------------

function RewardsSection() {
  const { failed, track } = useLoadFailure();
  const [rows, setRows] = useState<AdminRewardRow[] | null>(null);
  const [open, setOpen] = useState<AdminRewardRow | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof fetchAdminRewardHistory>>>([]);
  const [points, setPoints] = useState("");
  const [adjustKey, setAdjustKey] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = () => track(fetchAdminRewards(), setRows);
  useEffect(() => {
    load();
  }, []);
  const show = (r: AdminRewardRow) => {
    setOpen(r);
    setMessage(null);
    track(fetchAdminRewardHistory(r.partyType, r.partyId), setHistory);
  };
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={Award}>Partner reward points</CardTitle>
      <LoadFailed failed={failed} onRetry={load} />
      <p style={hint}>Points partners earn on settled sales (not customer credit). Adjustments need a reason and are audited.</p>
      <div style={{ overflowX: "auto" }}>
        <StackTable>
          <thead><tr><th style={thStyle}>Partner</th><th style={thStyle}>Available</th><th style={thStyle}>Debt</th><th style={thStyle}>Earned</th><th style={thStyle}>Redeemed</th><th style={thStyle}></th></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={`${r.partyType}:${r.partyId}`}>
                <td style={tdStyle}>{r.partyType}:{r.partyId}</td>
                <td style={tdStyle}>{r.available.toLocaleString("en-IE")}</td>
                <td style={{ ...tdStyle, color: r.debt > 0 ? colors.danger : colors.text }}>{r.debt.toLocaleString("en-IE")}</td>
                <td style={tdStyle}>{r.earned.toLocaleString("en-IE")}</td>
                <td style={tdStyle}>{r.redeemed.toLocaleString("en-IE")}</td>
                <td style={tdStyle}><Button variant="ghost" onClick={() => show(r)}>History…</Button></td>
              </tr>
            ))}
            {rows && rows.length === 0 && !failed && <tr><td style={tdStyle} colSpan={6}>No points yet.</td></tr>}
          </tbody>
        </StackTable>
      </div>
      {/* History and adjustment in one popup (2026-10-16); the reason is part of the form. */}
      <AdminModal
        open={!!open}
        onClose={() => {
          setOpen(null);
          setMessage(null);
        }}
        wide
        dirty={!!points || !!adjustReason}
        title={open ? `Reward points: ${open.partyType} ${open.partyId}` : ""}
        footer={
          <>
            <AdminButton variant="quiet" onClick={() => setOpen(null)}>
              Close
            </AdminButton>
            <AdminButton
              variant="primary"
              disabled={!/^-?\d+$/.test(points) || Number(points) === 0 || adjustReason.trim().length < 5 || adjusting}
              onClick={async () => {
                if (!open) return;
                setAdjusting(true);
                setMessage(null);
                try {
                  const r = await adjustPartnerPoints(open.partyType, open.partyId, { points: Number(points), reason: adjustReason.trim(), idempotencyKey: adjustKey || `adj-${crypto.randomUUID()}` });
                  setMessage(r.duplicate ? "Already applied (duplicate ignored)." : `Adjusted by ${points} points.`);
                  setPoints("");
                  setAdjustReason("");
                  setAdjustKey(`adj-${crypto.randomUUID()}`);
                  load();
                  show(open);
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : "That didn't work");
                } finally {
                  setAdjusting(false);
                }
              }}
            >
              {adjusting ? "Adjusting…" : "Adjust points"}
            </AdminButton>
          </>
        }
      >
        {open && (
          <>
            <div className="adm-dlg-grid">
              <Field label="Adjust points (+/−)"><input value={points} onChange={(e) => setPoints(e.target.value)} inputMode="numeric" placeholder="e.g. 50 or -20" style={inputStyle} /></Field>
              <Field label="Reason (required, audited)"><input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} style={inputStyle} /></Field>
            </div>
            {message && <p style={{ fontSize: 13, margin: "10px 0 0" }} role="status">{message}</p>}
            <h4 style={{ margin: "18px 0 6px", fontSize: 14 }}>History</h4>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13.5 }}>
              {history.map((e) => (
                <li key={e.id} style={{ display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${colors.border}`, padding: "6px 0" }}>
                  <span>{when(e.at)} · {e.kind}{e.sourceRef ? ` · ${e.sourceRef}` : ""}{e.note ? ` · ${e.note}` : ""}</span>
                  <strong>{e.points > 0 ? `+${e.points}` : e.points}</strong>
                </li>
              ))}
              {history.length === 0 && <li style={{ color: colors.mutedLight }}>No points history yet.</li>}
            </ul>
          </>
        )}
      </AdminModal>
    </Card>
  );
}

export function CouponsUsageSection({ onEditCoupons }: { onEditCoupons?: () => void }) {
  const { failed, track } = useLoadFailure();
  const [rows, setRows] = useState<AdminCouponUsage[] | null>(null);
  const load = () => {
    track(fetchCouponUsage(), setRows);
  };
  useEffect(load, []);
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={TicketPercent}>Coupon usage</CardTitle>
      <LoadFailed failed={failed} onRetry={load} />
      <p style={hint}>
        From the redemption ledger. "Returned" = released after an unpaid checkout or reversed on refund.
        {onEditCoupons && (
          <>
            {" "}To create, pause or archive a code, use the{" "}
            <button type="button" className="btn-reset link-accent" onClick={onEditCoupons} style={{ fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer", fontSize: "inherit" }}>
              Codes tab
            </button>
            .
          </>
        )}
      </p>
      <div style={{ overflowX: "auto" }}>
        <StackTable>
          <thead><tr><th style={thStyle}>Code</th><th style={thStyle}>Uses</th><th style={thStyle}>Confirmed</th><th style={thStyle}>Returned</th><th style={thStyle}>Discount given</th><th style={thStyle}>HelloCircle-funded</th><th style={thStyle}>Last used</th></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.code}>
                <td style={tdStyle}>{r.code}</td>
                <td style={tdStyle}>{r.uses}</td>
                <td style={tdStyle}>{r.confirmed}</td>
                <td style={tdStyle}>{r.returned}</td>
                <td style={tdStyle}>{euro(r.discountMinor)}</td>
                <td style={tdStyle}>{euro(r.platformFundedMinor)}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{when(r.lastUsedAt)}</td>
              </tr>
            ))}
            {rows && rows.length === 0 && !failed && <tr><td style={tdStyle} colSpan={7}>No coupon use yet.</td></tr>}
          </tbody>
        </StackTable>
      </div>
    </Card>
  );
}

function BankPayoutsSection() {
  const { failed, track } = useLoadFailure();
  const [rows, setRows] = useState<AdminBankPayout[] | null>(null);
  const load = () => {
    track(fetchBankPayouts(), setRows);
  };
  useEffect(load, []);
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={Landmark}>Bank payouts</CardTitle>
      <LoadFailed failed={failed} onRetry={load} />
      <p style={hint}>Stripe paying a partner's Stripe balance to their bank (Stripe's schedule) — separate from HelloCircle's transfers.</p>
      <div style={{ overflowX: "auto" }}>
        <StackTable>
          <thead><tr><th style={thStyle}>Payout</th><th style={thStyle}>Partner</th><th style={thStyle}>Amount</th><th style={thStyle}>Status</th><th style={thStyle}>Arrives</th></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id}>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{r.id}</td>
                <td style={tdStyle}>{r.partyType ? `${r.partyType}:${r.partyId}` : r.accountId}</td>
                <td style={tdStyle}>{euro(r.amountMinor)}</td>
                <td style={{ ...tdStyle, color: r.status === "failed" ? colors.danger : colors.text }}>{r.status}{r.failureCode ? ` (${r.failureCode})` : ""}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{when(r.arrivalDate)}</td>
              </tr>
            ))}
            {rows && rows.length === 0 && !failed && <tr><td style={tdStyle} colSpan={5}>No bank payouts yet.</td></tr>}
          </tbody>
        </StackTable>
      </div>
    </Card>
  );
}

// --- webhooks / refunds / disputes ---------------------------------------------------

function WebhooksSection({ onOpen }: { onOpen: (key: string) => void }) {
  const { failed, track } = useLoadFailure();
  // The filter lives in the URL so Back from an event returns to the same view.
  const [statusParam, setStatusParam] = useUrlParam<string>("events", "manual_review");
  const status = statusParam === "all" ? "" : statusParam;
  const setStatus = (v: string) => setStatusParam(v === "" ? "all" : v);
  const [rows, setRows] = useState<WebhookEventRow[]>([]);
  const load = () => track(fetchWebhookEvents(status || undefined), setRows);
  useEffect(() => {
    load();
  }, [status]);
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={Zap}>Payment events</CardTitle>
      <LoadFailed failed={failed} onRetry={load} />
      <p style={hint}>Every verified Stripe event, stored once. Failed events retry automatically; after five attempts (or when one can't be matched) they wait here for review.</p>
      <Field label="Show">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, maxWidth: 260 }}>
          <option value="manual_review">Needs review</option>
          <option value="failed">Failed (will retry)</option>
          <option value="processed">Processed</option>
          <option value="ignored">Stored, no action</option>
          <option value="resolved">Resolved by a payment review</option>
          <option value="">All</option>
        </select>
      </Field>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <StackTable>
          <thead><tr><th style={thStyle}>Received</th><th style={thStyle}>Event</th><th style={thStyle}>Status</th><th style={thStyle}>Error</th><th style={thStyle} /></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{when(e.receivedAt)}</td>
                <td style={{ ...tdStyle, fontSize: 12.5 }}>{e.eventType}<div style={{ color: colors.mutedLight }}>{e.eventId}</div></td>
                <td style={tdStyle}>{e.status} ({e.attempts})</td>
                <td style={{ ...tdStyle, fontSize: 12.5, maxWidth: 280 }}>{e.lastError ?? ""}</td>
                <td style={tdStyle}><Button variant="ghost" onClick={() => onOpen(`event:${e.id}`)} aria-label={`Open event ${e.id}`}>{e.status === "failed" || e.status === "manual_review" ? "Review" : "Open"}</Button></td>
              </tr>
            ))}
            {rows.length === 0 && !failed && <tr><td style={tdStyle} colSpan={5}>Nothing here.</td></tr>}
          </tbody>
        </StackTable>
      </div>
    </Card>
  );
}

/** D-10 / D-11 — payments received that couldn't simply be confirmed. The
 * review is the finance record of the money; the order, its capacity hold and
 * the review are shown as separate facts. Urgent ones first. */
function PaymentReviewsSection({ onOpen }: { onOpen: (key: string) => void }) {
  const { failed, track } = useLoadFailure();
  const [statusParam, setStatusParam] = useUrlParam<string>("reviews", "open");
  const status = (["open", "resolved", "all"].includes(statusParam) ? statusParam : "open") as "open" | "resolved" | "all";
  const [rows, setRows] = useState<PaymentReviewRow[]>([]);
  const load = () => track(fetchPaymentReviews(status), setRows);
  useEffect(() => {
    load();
  }, [status]);
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={Wallet}>Payment reviews</CardTitle>
      <LoadFailed failed={failed} onRetry={load} />
      <p style={hint}>Payments Stripe confirmed that couldn't simply confirm a booking: the amount differed, the place was gone, the organisation was suspended, or it arrived too late. Each one is the record of the money received. Places are held only until the deadline; expiry never refunds. Close a review with Recheck with Stripe after any refund.</p>
      <Field label="Show">
        <select value={status} onChange={(e) => setStatusParam(e.target.value)} style={{ ...inputStyle, maxWidth: 260 }}>
          <option value="open">Open</option>
          <option value="resolved">Closed</option>
          <option value="all">All</option>
        </select>
      </Field>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <StackTable>
          <thead>
            <tr>
              <th style={thStyle}>Flagged</th>
              <th style={thStyle}>Order</th>
              <th style={thStyle}>Received</th>
              <th style={thStyle}>Why</th>
              <th style={thStyle}>Booking</th>
              <th style={thStyle}>Place</th>
              <th style={thStyle}><span className="adm-visually-hidden">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const urgent = r.urgency === "within_lead" || r.urgency === "after_start";
              return (
                <tr key={r.id}>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>{when(r.flaggedAt)}{urgent && r.status === "open" && <div style={{ color: colors.danger, fontWeight: 700 }}>Urgent</div>}</td>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>{r.sourceType && r.sourceRef ? `${r.sourceType} ${r.sourceRef}` : "Not linked"}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.receivedMinor !== null ? euro(r.receivedMinor) : "—"}</td>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>{REVIEW_REASON[r.reason] ?? r.reason}{r.status !== "open" && <div style={{ color: colors.mutedLight }}>Closed — {r.resolution}</div>}</td>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>{bookingState(r.order)}</td>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>{HOLD_LABEL[r.holdStatus] ?? r.holdStatus}{r.holdStatus === "held" && r.reviewHoldUntil && <div style={{ color: colors.mutedLight }}>until {when(r.reviewHoldUntil)}</div>}</td>
                  <td style={tdStyle}><Button variant="ghost" onClick={() => onOpen(`review:${r.id}`)} aria-label={`Open payment review ${r.id}`}>Open</Button></td>
                </tr>
              );
            })}
            {rows.length === 0 && !failed && <tr><td style={tdStyle} colSpan={7}>Nothing here.</td></tr>}
          </tbody>
        </StackTable>
      </div>
    </Card>
  );
}

function RefundsSection({ onOpen }: { onOpen: (key: string) => void }) {
  const { failed, track } = useLoadFailure();
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [form, setForm] = useState({ sourceType: "booking", ref: "", amount: "", responsible: "platform" });
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const load = () => track(fetchRefunds(), setRows);
  const canRefund = useAdminCan()("finance.operate");
  useEffect(() => {
    load();
  }, []);
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={Undo2}>Refunds</CardTitle>
      {!canRefund && <p style={hint}>Read-only for your admin role: you can see refund state, but only finance can issue refunds.</p>}
      <LoadFailed failed={failed} onRetry={load} />
      <p style={hint}>Full, partial or remaining refunds of any online order. Leave the amount empty to refund everything still refundable.</p>
      {canRefund && (
        <div>
          <Button onClick={() => setFormOpen(true)}>Issue a refund</Button>
        </div>
      )}
      {/* The refund form is a popup (2026-10-16); "Refund…" then asks for the reason. */}
      <AdminModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        dirty={!!form.ref || !!form.amount}
        title="Issue a refund"
        subtitle="Leave the amount empty to refund everything still refundable."
        footer={
          <>
            <AdminButton variant="quiet" onClick={() => setFormOpen(false)}>
              Cancel
            </AdminButton>
            <AdminButton variant="primary" disabled={!form.ref} onClick={() => { setFormOpen(false); setOpen(true); }}>
              Refund…
            </AdminButton>
          </>
        }
      >
      <div className="adm-dlg-grid">
        <Field label="Order type"><select value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })} style={inputStyle}>{["booking", "registration", "program", "experience", "game"].map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="Reference"><input value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value.trim() })} style={inputStyle} /></Field>
        <Field label="Amount (€, optional)"><input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} inputMode="decimal" /></Field>
        <Field label="Responsible"><select value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} style={inputStyle}><option value="platform">HelloCircle</option><option value="partner">Partner</option><option value="customer">Customer</option></select></Field>
      </div>
      </AdminModal>
      {result && <p style={{ fontSize: 13, margin: "10px 0 0" }}>{result}</p>}
      <div style={{ overflowX: "auto", marginTop: 14 }}>
        <StackTable>
          <thead><tr><th style={thStyle}>Order</th><th style={thStyle}>Amount</th><th style={thStyle}>Kind</th><th style={thStyle}>Origin</th><th style={thStyle}>Refund</th><th style={thStyle}>Reason</th><th style={thStyle}><span className="adm-visually-hidden">Open</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}><td style={tdStyle}>{r.source_type} {r.source_ref}</td><td style={{ ...tdStyle, fontWeight: 600 }}>{euro(r.amount_minor)}</td><td style={tdStyle}>{r.kind}</td><td style={tdStyle}>{r.origin}</td><td style={tdStyle}>{r.status}</td><td style={{ ...tdStyle, fontSize: 12.5 }}>{r.reason}</td><td style={tdStyle}>{canRefund && <Button variant="ghost" onClick={() => onOpen(`refund:${r.id}`)} aria-label={`Open refund ${r.id}`}>Open</Button>}</td></tr>
            ))}
            {rows.length === 0 && !failed && <tr><td style={tdStyle} colSpan={7}>No refunds yet.</td></tr>}
          </tbody>
        </StackTable>
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

function DisputesSection({ onOpen }: { onOpen: (key: string) => void }) {
  const { failed, track } = useLoadFailure();
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const load = () => track(fetchDisputes(), setRows);
  useEffect(() => {
    load();
  }, []);
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={Gavel}>Disputes</CardTitle>
      <LoadFailed failed={failed} onRetry={load} />
      <p style={hint}>When a dispute is lost, decide who bears it: a partner-caused loss is recovered from the partner's available balance; a platform-caused loss is absorbed by HelloCircle.</p>
      <div style={{ overflowX: "auto" }}>
        <StackTable>
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
                  <Button variant="ghost" onClick={() => onOpen(`dispute:${d.id}`)} aria-label={`Open dispute ${d.provider_dispute_id}`}>
                    {d.status === "lost" && d.recovery_status === "pending" ? "Decide recovery" : "Open"}
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !failed && <tr><td style={tdStyle} colSpan={6}>No disputes.</td></tr>}
          </tbody>
        </StackTable>
      </div>
    </Card>
  );
}

// --- plans, promotions, roles, help -------------------------------------------------

function PlansSection() {
  const { failed, track } = useLoadFailure();
  const [overview, setOverview] = useState<PlansOverview | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [partner, setPartner] = useState({ kind: "org", id: "", plan: "pro" });
  const [current, setCurrent] = useState<string | null>(null);
  const [campaignForm, setCampaignForm] = useState({ key: "founding-partners", days: "90", max: "30", commission: "free", ends: "" });
  const [enrol, setEnrol] = useState({ campaignId: "", kind: "org", id: "" });
  const [dialog, setDialog] = useState<null | "assign" | "campaign" | "enrol">(null);
  const [planForm, setPlanForm] = useState<null | "assign" | "campaign" | "enrol">(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = () => {
    track(fetchPlansOverview(), setOverview);
    track(fetchCampaigns(), setCampaigns);
  };
  useEffect(load, []);
  const pct = (bps: unknown) => `${Number(bps) / 100}%`;
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={BadgePercent}>Plans and promotions</CardTitle>
      <LoadFailed failed={failed} onRetry={load} />
      {overview && (
        <p style={hint}>
          Free: {pct(overview.free.successFeeBps)} (min {euro(overview.free.minFeeMinor as number)}) · Pro: {euro(overview.pro.subscriptionMonthlyMinor as number)}/month, {pct(overview.pro.successFeeBps)} (min {euro(overview.pro.minFeeMinor as number)})
          {overview.proBreakEvenMonthlyGmvMinor !== null && <> · Pro break-even {euro(overview.proBreakEvenMonthlyGmvMinor)}/month</>}. Edit rates in Commercial rules.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 4px" }}>
        <Button onClick={() => setPlanForm("assign")}>Change a partner's plan</Button>
        <Button variant="ghost" onClick={() => setPlanForm("campaign")}>New promotion</Button>
        <Button variant="ghost" onClick={() => setPlanForm("enrol")}>Enrol a partner</Button>
      </div>
      {message && <p style={{ fontSize: 13, margin: "8px 0 0" }}>{message}</p>}
      {/* Plan forms are popups (2026-10-16); their final button asks for the reason. */}
      <AdminModal open={planForm === "assign"} onClose={() => setPlanForm(null)} title="Change a partner's plan" subtitle="Takes effect from now. Existing bookings keep their original fees." footer={<><AdminButton variant="quiet" onClick={() => setPlanForm(null)}>Cancel</AdminButton><AdminButton variant="primary" disabled={!partner.id} onClick={() => { setPlanForm(null); setDialog("assign"); }}>Change plan…</AdminButton></>}>
      <div className="adm-dlg-grid">
        <Field label="Partner kind"><select value={partner.kind} onChange={(e) => setPartner({ ...partner, kind: e.target.value })} style={inputStyle}><option value="org">Organisation</option><option value="vendor">Vendor</option><option value="host">Host</option></select></Field>
        <Field label="Partner id"><input value={partner.id} onChange={(e) => setPartner({ ...partner, id: e.target.value.trim() })} style={inputStyle} /></Field>
        <Button variant="ghost" disabled={!partner.id} onClick={() => fetchPartnerPlan(partner.kind, partner.id).then((r) => setCurrent(`${r.current.planKey} (fees: ${r.current.feePlanKey}, ${r.current.source}${r.current.effectiveTo ? `, until ${when(r.current.effectiveTo)}` : ""})`)).catch((e) => setCurrent(e.message))}>Look up</Button>
        <Field label="Move to"><select value={partner.plan} onChange={(e) => setPartner({ ...partner, plan: e.target.value })} style={inputStyle}><option value="free">Free</option><option value="pro">Pro</option></select></Field>
      </div>
      {current && <p style={{ fontSize: 13, margin: "10px 0 0" }}>Current plan: {current}</p>}
      </AdminModal>

      <h4 style={{ margin: "16px 0 8px", fontSize: 14 }}>Promotions</h4>
      <div style={{ overflowX: "auto" }}>
        <StackTable>
          <thead><tr><th style={thStyle}>Campaign</th><th style={thStyle}>Benefit</th><th style={thStyle}>Commission on</th><th style={thStyle}>Enrolled</th><th style={thStyle}>Window</th></tr></thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}><td style={tdStyle}>{c.campaignKey} (#{c.id})</td><td style={tdStyle}>{c.planKey} for {c.benefitDays} days</td><td style={tdStyle}>{c.commissionPlanKey}</td><td style={tdStyle}>{c.enrolled}/{c.maxEnrollments}</td><td style={{ ...tdStyle, fontSize: 12.5 }}>{when(c.startsAt)} → {when(c.endsAt)}</td></tr>
            ))}
            {campaigns.length === 0 && !failed && <tr><td style={tdStyle} colSpan={5}>No campaigns yet.</td></tr>}
          </tbody>
        </StackTable>
      </div>
      <AdminModal open={planForm === "campaign"} onClose={() => setPlanForm(null)} title="New promotion" subtitle="Pro subscription waived for a number of days, for a limited number of partners." footer={<><AdminButton variant="quiet" onClick={() => setPlanForm(null)}>Cancel</AdminButton><AdminButton variant="primary" disabled={!campaignForm.ends} onClick={() => { setPlanForm(null); setDialog("campaign"); }}>Create campaign…</AdminButton></>}>
      <div className="adm-dlg-grid">
        <Field label="Key"><input value={campaignForm.key} onChange={(e) => setCampaignForm({ ...campaignForm, key: e.target.value })} style={inputStyle} /></Field>
        <Field label="Pro waived (days)"><input value={campaignForm.days} onChange={(e) => setCampaignForm({ ...campaignForm, days: e.target.value })} style={inputStyle} /></Field>
        <Field label="Max partners"><input value={campaignForm.max} onChange={(e) => setCampaignForm({ ...campaignForm, max: e.target.value })} style={inputStyle} /></Field>
        <Field label="Commission"><select value={campaignForm.commission} onChange={(e) => setCampaignForm({ ...campaignForm, commission: e.target.value })} style={inputStyle}><option value="free">Free rate</option><option value="pro">Pro rate</option></select></Field>
        <Field label="Enrolment closes"><input type="date" value={campaignForm.ends} onChange={(e) => setCampaignForm({ ...campaignForm, ends: e.target.value })} style={inputStyle} /></Field>
      </div>
      </AdminModal>
      <AdminModal open={planForm === "enrol"} onClose={() => setPlanForm(null)} title="Enrol a partner in a promotion" footer={<><AdminButton variant="quiet" onClick={() => setPlanForm(null)}>Cancel</AdminButton><AdminButton variant="primary" disabled={!enrol.campaignId || !enrol.id} onClick={() => { setPlanForm(null); setDialog("enrol"); }}>Enrol partner…</AdminButton></>}>
      <div className="adm-dlg-grid">
        <Field label="Campaign #"><input value={enrol.campaignId} onChange={(e) => setEnrol({ ...enrol, campaignId: e.target.value })} style={inputStyle} /></Field>
        <Field label="Partner kind"><select value={enrol.kind} onChange={(e) => setEnrol({ ...enrol, kind: e.target.value })} style={inputStyle}><option value="org">Organisation</option><option value="vendor">Vendor</option><option value="host">Host</option></select></Field>
        <Field label="Partner id"><input value={enrol.id} onChange={(e) => setEnrol({ ...enrol, id: e.target.value.trim() })} style={inputStyle} /></Field>
      </div>
      </AdminModal>
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

/** Exported for Admin → Settings (admin redesign 2026-10-14), its home now. */
export function RolesSection() {
  const { failed, track } = useLoadFailure();
  const [admins, setAdmins] = useState<AdminAccount[] | null>(null);
  const [change, setChange] = useState<{ admin: AdminAccount; role: string } | null>(null);
  const load = () => track(fetchAdmins(), setAdmins);
  useEffect(() => {
    load();
  }, []);
  // Only super admins can list roles: a 401/403 hides the section; any other
  // failure is shown, not silently dropped.
  if (!admins && (!failed || failed.forbidden)) return null;
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={UserCog}>Admin roles</CardTitle>
      <LoadFailed failed={failed && !failed.forbidden ? failed : null} onRetry={load} />
      <p style={hint}>Super: everything. Finance: money, rules, coupons. Support: moderation and support. Legal: policies and help content. Only a super admin changes roles; at least one super admin always remains.</p>
      <div style={{ overflowX: "auto" }}>
        <StackTable>
          <thead><tr><th style={thStyle}>Admin</th><th style={thStyle}>Role</th></tr></thead>
          <tbody>
            {(admins ?? []).map((a) => (
              <tr key={a.id}>
                <td style={tdStyle}>{a.name || a.email}<div style={{ fontSize: 12, color: colors.mutedLight }}>{a.email}</div></td>
                <td style={tdStyle}>
                  <select value={a.adminRole ?? ""} onChange={(e) => e.target.value && setChange({ admin: a, role: e.target.value })} style={{ ...inputStyle, maxWidth: 160 }} aria-label={`Role for ${a.email}`}>
                    {!a.adminRole && <option value="" disabled>No role (no access)</option>}
                    {["super", "finance", "support", "legal"].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </StackTable>
      </div>
      {change && <ReasonDialog title={`Make ${change.admin.email} ${change.role}`} confirm="Change role" onClose={() => { setChange(null); load(); }} onConfirm={async (reason) => { await setAdminRole(change.admin.id, change.role, reason); }} />}
    </Card>
  );
}

/** Exported for Admin → Settings (admin redesign 2026-10-14), its home now. */
export function HelpSection() {
  const { failed, track } = useLoadFailure();
  const [entries, setEntries] = useState<FieldHelpEntry[]>([]);
  const [edit, setEdit] = useState<FieldHelpEntry | null>(null);
  const [draft, setDraft] = useState<FieldHelpEntry | null>(null);
  const load = () => track(fetchFieldHelp(), setEntries);
  useEffect(() => {
    load();
  }, []);
  return (
    <Card style={{ padding: 22 }}>
      <CardTitle icon={CircleQuestionMark}>Field help</CardTitle>
      <LoadFailed failed={failed} onRetry={load} />
      <p style={hint}>The explanations behind every ⓘ on pricing and earnings screens. Each edit creates a new version.</p>
      <div style={{ overflowX: "auto" }}>
        <StackTable>
          <thead><tr><th style={thStyle}>Field</th><th style={thStyle}>Definition</th><th style={thStyle}>Version</th><th style={thStyle} /></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.helpKey}><td style={tdStyle}>{e.name}</td><td style={{ ...tdStyle, fontSize: 12.5, maxWidth: 420 }}>{e.definition}</td><td style={tdStyle}>v{e.version}</td><td style={tdStyle}><Button variant="ghost" onClick={() => { setEdit(e); setDraft({ ...e }); }}>Edit</Button></td></tr>
            ))}
          </tbody>
        </StackTable>
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

// --- overview tab: what needs attention, with icons (2026-10-16) ------------------------

function FinanceOverview({ attention, onOpen }: { attention: { reviews: number; disputes: number; events: number } | null; onOpen: (section: string) => void }) {
  const items = [
    { key: "reviews", label: "Payment reviews", hint: "Money received, not yet confirmed", icon: Wallet, n: attention?.reviews },
    { key: "disputes", label: "Disputes", hint: "Need a response or a recovery decision", icon: Gavel, n: attention?.disputes },
    { key: "events", label: "Payment events", hint: "Parked for a manual check", icon: Zap, n: attention?.events },
  ];
  const waiting = items.reduce((t, i) => t + (i.n ?? 0), 0);
  const first = items.find((i) => i.n);
  return (
    <>
      {waiting > 0 && first && (
        <AttentionBanner icon={AlertTriangle} action={<AdminButton variant="primary" onClick={() => onOpen(first.key)}>Review next</AdminButton>}>
          <strong>
            {waiting} thing{waiting === 1 ? "" : "s"} need{waiting === 1 ? "s" : ""} attention:
          </strong>{" "}
          {items
            .filter((i) => i.n)
            .map((i) => `${i.n} ${i.label.toLowerCase()}`)
            .join(", ")}
          .
        </AttentionBanner>
      )}
      <section aria-label="Needs attention" className="adm-fin-cards">
        {items.map((i) => (
          <button key={i.key} type="button" className="adm-fin-card" onClick={() => onOpen(i.key)}>
            <IconTile icon={i.icon} tone={i.n ? "hot" : undefined} />
            <span>
              <span className="adm-fin-card-n" data-zero={!i.n || undefined}>
                {i.n ?? "…"}
              </span>
              <span className="adm-fin-card-l">{i.label}</span>
              <span className="adm-fin-card-h">{i.hint}</span>
            </span>
          </button>
        ))}
      </section>
      <OverviewSection />
    </>
  );
}

// --- the tab -------------------------------------------------------------------------

const SECTIONS: { key: string; label: string; permission: string; group: string; icon: LucideIcon; description: string; page: FinancePage }[] = [
  { key: "overview", label: "Overview", permission: "", group: "", icon: LayoutDashboard, description: "", page: "finance" },
  { key: "reviews", label: "Payment reviews", permission: "finance.operate", group: "Needs attention", icon: Wallet, description: "Money received, not yet confirmed", page: "finance" },
  { key: "disputes", label: "Disputes", permission: "finance.operate", group: "Needs attention", icon: Gavel, description: "Chargebacks needing a response or recovery", page: "finance" },
  { key: "events", label: "Payment events", permission: "finance.operate", group: "Needs attention", icon: Zap, description: "Provider events parked for a manual check", page: "finance" },
  { key: "refunds", label: "Refunds", permission: "finance.payment_state.view", group: "Needs attention", icon: Undo2, description: "Refunds issued and their status", page: "finance" },
  { key: "settlements", label: "Settlements", permission: "finance.operate", group: "Partner money", icon: Calculator, description: "Weekly runs of what partners earned", page: "finance" },
  { key: "transfers", label: "Transfers", permission: "finance.operate", group: "Partner money", icon: ArrowLeftRight, description: "Money sent to partner accounts", page: "finance" },
  { key: "payouts", label: "Bank payouts", permission: "finance.operate", group: "Partner money", icon: Landmark, description: "Stripe payouts to partner banks", page: "finance" },
  { key: "debts", label: "Partner debts", permission: "finance.operate", group: "Partner money", icon: Receipt, description: "What partners owe after refunds and disputes", page: "finance" },
  { key: "credits", label: "Credits & Pro", permission: "finance.operate", group: "Customers", icon: PiggyBank, description: "Customer credit and Pro billing", page: "plans" },
  { key: "rewards", label: "Reward points", permission: "finance.operate", group: "Partners", icon: Award, description: "Partner reward point balances", page: "plans" },
  { key: "plans", label: "Plans & promotions", permission: "finance.operate", group: "Partners", icon: BadgePercent, description: "Free and Pro plans, and promotions", page: "plans" },
  { key: "simulator", label: "Simulator", permission: "finance.operate", group: "Tools", icon: FlaskConical, description: "Try a price before changing a rule", page: "plans" },
];

/** Finance is two pages (2026-10-16, owner's choice): Finance (money in, problems,
 * payouts, ledger) and Plans & credit (credit, points, plans, simulator). Coupon
 * usage lives on the Coupons page. Old `?tab=finance&section=…` links follow. */
export type FinancePage = "finance" | "plans";
export const PLANS_SECTIONS = new Set(SECTIONS.filter((x) => x.page === "plans").map((x) => x.key));

/** Open payment reviews and disputes that need a response or a recovery decision. */
function useFinanceAttention(enabled: boolean) {
  const [counts, setCounts] = useState<{ reviews: number; disputes: number; events: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    Promise.all([
      fetchPaymentReviews("open").catch(() => null),
      fetchDisputes().catch(() => null),
      fetchWebhookEvents("manual_review").catch(() => null),
    ]).then(([r, d, e]) =>
      setCounts({
        reviews: r?.length ?? 0,
        disputes: (d ?? []).filter((x) => x.status === "needs_response" || x.status === "warning_needs_response" || (x.status === "lost" && x.recovery_status === "pending")).length,
        events: e?.length ?? 0,
      })
    );
  }, [enabled]);
  return counts;
}

export function AdminFinanceTab({ page = "finance" }: { initialSection?: string; onEditCoupons?: () => void; page?: FinancePage } = {}) {
  // D-02: sections follow the admin's permissions (support sees refunds read-only).
  const can = useAdminCan();
  // "Finance home" is shown whenever any section is.
  const sectionsAllowed = SECTIONS.filter((s) => s.key !== "overview" && s.page === page && can(s.permission));
  // Finance opens on its Overview; Plans & credit opens on its first section.
  const visible = page === "finance" && sectionsAllowed.length && can("finance.operate") ? [SECTIONS[0], ...sectionsAllowed] : sectionsAllowed;
  // Section, list filters and the open record are URL state (UI completion):
  // a record is its own page and Back returns to the same section and filter.
  const [sectionParam, setSectionParam] = useUrlParam<string>("section", visible[0]?.key ?? "overview");
  const section = visible.some((s) => s.key === sectionParam) ? sectionParam : visible[0]?.key ?? "overview";
  const setSection = (k: string) => setSectionParam(k);
  const [record, openRecord, closeRecord] = useRecordParam();
  const attention = useFinanceAttention(page === "finance" && can("finance.operate"));
  if (!visible.length) return <p style={hint}>Your admin role doesn't include {page === "plans" ? "plans and credit" : "finance"} tools.</p>;
  if (record) return <FinanceRecordPage record={record} section={section} onBack={closeRecord} onOpen={openRecord} />;
  const countFor = (k: string) => (k === "reviews" ? attention?.reviews : k === "disputes" ? attention?.disputes : k === "events" ? attention?.events : undefined);
  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <IconTabs
        label={page === "plans" ? "Plans and credit sections" : "Finance sections"}
        value={section}
        onChange={setSection}
        items={visible.map((x) => ({ key: x.key, label: x.label, icon: x.icon, count: countFor(x.key), group: x.group }))}
      />
      {section === "overview" && <FinanceOverview attention={attention} onOpen={setSection} />}
      {section === "simulator" && <SimulatorSection />}
      {section === "settlements" && <SettlementsSection onOpen={openRecord} />}
      {section === "transfers" && <TransfersSection onOpen={openRecord} />}
      {section === "debts" && <DebtsSection />}
      {section === "credits" && <CreditsProSection />}
      {section === "rewards" && <RewardsSection />}
      {section === "payouts" && <BankPayoutsSection />}
      {section === "reviews" && <PaymentReviewsSection onOpen={openRecord} />}
      {section === "events" && <WebhooksSection onOpen={openRecord} />}
      {section === "refunds" && <RefundsSection onOpen={openRecord} />}
      {section === "disputes" && <DisputesSection onOpen={openRecord} />}
      {section === "plans" && <PlansSection />}
    </div>
  );
}
