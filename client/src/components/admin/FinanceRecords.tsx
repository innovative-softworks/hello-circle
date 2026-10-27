import { useEffect, useId, useState, type ReactNode } from "react";
import {
  ApiError,
  decideDisputeRecovery,
  fetchDisputes,
  fetchOrderAllocation,
  fetchPaymentRecords,
  fetchRefunds,
  fetchSettlement,
  fetchTransferAllocations,
  fetchTransfers,
  fetchWebhookEvents,
  fetchPaymentReview,
  issueAdminRefund,
  recheckPaymentReview,
  replayWebhookEvent,
  reverseTransferAllocation,
  type AdminTransfer,
  type DisputeRow,
  type OrderAllocation,
  type PaymentReviewDetail,
  type PaymentRecordRow,
  type RefundRow,
  type SettlementDetail,
  type TransferAllocation,
  type WebhookEventRow,
} from "../../api";
import { ConfirmDialog } from "../ui";
import { RecordState, RecordView } from "../workspace/RecordView";
import { DetailStats } from "../workspace/DetailParts";
import { ObjectActivity } from "./AdminAudit";
import { AdminButton, Facts, SectionLabel, StatusTag, formatDate, statusLabel } from "./adminUi";
import { dueLabel } from "./timeLabels";
import { useToast } from "../Toast";

// Finance record pages (UI completion 2026-10-14). Each is opened from its
// Finance section list with `?record=<kind>:<id>` and returns to that section
// with its filter. They only read existing finance endpoints and offer the
// operations those sections already had (replay, refund, dispute recovery,
// partial allocation reversal) — nothing new moves money, and every write still
// asks for an audited reason. Payment, refund, settlement, transfer, dispute
// and recovery statuses are shown as separate labelled facts, never merged.
//
// Lists are bounded server-side (latest 200 rows); a record older than that
// can't be found from its list and says so.

const euro = (minor: number | string | null | undefined, currency = "EUR") => {
  const n = Number(minor ?? 0);
  const sym = currency.toUpperCase() === "EUR" ? "€" : `${currency.toUpperCase()} `;
  return `${n < 0 ? "−" : ""}${sym}${(Math.abs(n) / 100).toFixed(2)}`;
};

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "missing" } | { state: "restricted" } | { state: "error"; message: string };

function useLoad<T>(loader: () => Promise<T | null>, deps: unknown[]): [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    loader()
      .then((d) => live && setLoad(d === null ? { state: "missing" } : { state: "ready", data: d }))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) setLoad({ state: "missing" });
        else if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setLoad({ state: "restricted" });
        else setLoad({ state: "error", message: e instanceof Error ? e.message : "Couldn't load" });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return [load, () => setN((x) => x + 1)];
}

function Gate<T>({ load, backLabel, onBack, retry, missing, children }: { load: Load<T>; backLabel: string; onBack: () => void; retry: () => void; missing: string; children: (d: T) => ReactNode }) {
  if (load.state === "loading") return <RecordState state="loading" backLabel={backLabel} onBack={onBack} />;
  if (load.state === "missing") return <RecordState state="missing" backLabel={backLabel} onBack={onBack} message={missing} />;
  if (load.state === "restricted") return <RecordState state="restricted" backLabel={backLabel} onBack={onBack} message="Finance records need the finance or super admin role." />;
  if (load.state === "error") return <RecordState state="error" backLabel={backLabel} onBack={onBack} onRetry={retry} />;
  return <>{children(load.data)}</>;
}

/** A labelled status chip, one per concern. */
function Status({ label, value, status }: { label: string; value: string; status?: string }) {
  return (
    <>
      <span className="adm-note">{label}:</span> <StatusTag status={status ?? value} label={value} />
    </>
  );
}

/** Reason field for an audited finance write (the server requires ≥ 5 characters). */
function ReasonField({ value, onChange, min = 5 }: { value: string; onChange: (v: string) => void; min?: number }) {
  const id = useId();
  return (
    <div className="adm-field" style={{ marginTop: 12 }}>
      <label htmlFor={id}>
        Reason <span aria-hidden="true">*</span>
      </label>
      <textarea id={id} className="adm-input" rows={3} required aria-describedby={`${id}-hint`} value={value} onChange={(e) => onChange(e.target.value)} />
      <p id={`${id}-hint`} className="adm-note" style={{ margin: "4px 0 0" }}>
        Required, at least {min} characters. Saved in the audit log.
      </p>
    </div>
  );
}

function Table({ caption, head, children }: { caption: string; head: string[]; children: ReactNode }) {
  return (
    <div className="adm-table-wrap">
      <table className="adm-table adm-table--stack">
        <caption className="adm-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th scope="col" key={i}>
                {h || <span className="adm-visually-hidden">Action</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const ORDER_TYPES = new Set(["booking", "registration", "program", "experience", "game", "pass"]);
const orderKey = (type: string | null | undefined, ref: string | null | undefined) => (type && ref && ORDER_TYPES.has(type) ? `order:${type}:${ref}` : null);

// --- settlement ---------------------------------------------------------------

function SettlementRecord({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (key: string) => void }) {
  const [load, retry] = useLoad<{ detail: SettlementDetail; transfers: AdminTransfer[] }>(
    async () => {
      const [detail, transfers] = await Promise.all([fetchSettlement(id), fetchTransfers().catch(() => [] as AdminTransfer[])]);
      return { detail, transfers };
    },
    [id]
  );
  return (
    <Gate load={load} backLabel="Settlements" onBack={onBack} retry={retry} missing="No settlement has this number.">
      {({ detail, transfers }) => {
        const s = detail.settlement;
        const mine = transfers.filter((t) => Number(t.settlementId) === Number(s.id));
        return (
          <RecordView
            title={`Settlement #${s.id}`}
            reference={`${s.party_type}:${s.party_id} · run ${s.run_id}`}
            backLabel="Settlements"
            onBack={onBack}
            statuses={
              <>
                <Status label="Settlement" value={s.status} />
                <Status label="Transfer" value={s.transfer_id ? "Sent to partner's Stripe account" : mine.length ? "Attempted — see Transfers" : "Not sent"} status={s.transfer_id ? "approved" : mine.length ? "pending" : "draft"} />
              </>
            }
            stats={
              <DetailStats
                items={
                  [
                    { label: "Net to partner", value: euro(s.net_minor, s.currency), sub: "This settlement" },
                    { label: "Items", value: String(detail.items.length), sub: "Ledger groups settled" },
                    { label: "Transfers", value: String(mine.length), sub: s.transfer_id ? "Sent" : mine.length ? "Attempted" : "None yet" },
                    { label: "Created", value: formatDate(s.created_at), sub: `Run ${s.run_id}` },
                  ]
                }
              />
            }
            aside={
              <>
                <SectionLabel>Transfers</SectionLabel>
                {mine.length === 0 ? (
                  <p className="adm-note">No transfer has been attempted for this settlement.</p>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                    {mine.map((t) => (
                      <li key={t.id}>
                        <AdminButton size="sm" onClick={() => onOpen(`transfer:${t.id}`)}>
                          Open transfer #{t.id} · {t.status}
                        </AdminButton>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            }
          >
            <SectionLabel>Amount</SectionLabel>
            <Facts
              rows={[
                ["Net to partner", euro(s.net_minor, s.currency)],
                ["Partner", `${s.party_type}:${s.party_id}`],
                ["Created", formatDate(s.created_at, true)],
                ["Last changed", formatDate(s.updated_at, true)],
                ["Paid reference", s.paid_reference || null],
                ["Ledger group", s.ledger_group_id ? <span className="adm-mono">{s.ledger_group_id}</span> : null],
              ]}
            />
            <SectionLabel>What it settles ({detail.items.length})</SectionLabel>
            {detail.items.length === 0 ? (
              <p className="adm-note">No line items.</p>
            ) : (
              <Table caption="Settlement items" head={["Item", "Amount"]}>
                {detail.items.map((it) => (
                  <tr key={it.groupId}>
                    <td data-label="Item">{it.description}</td>
                    <td data-label="Amount">{euro(it.amountMinor, s.currency)}</td>
                  </tr>
                ))}
              </Table>
            )}
            <SectionLabel>History</SectionLabel>
            <ObjectActivity objectIds={[String(s.id), s.party_id]} note="Settlement runs are audited per run; this shows entries recorded against this settlement or partner." />
          </RecordView>
        );
      }}
    </Gate>
  );
}

// --- transfer -----------------------------------------------------------------

function TransferRecord({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (key: string) => void }) {
  const toast = useToast();
  const [load, retry] = useLoad<{ t: AdminTransfer; allocations: TransferAllocation[] }>(
    async () => {
      const t = (await fetchTransfers()).find((x) => String(x.id) === id);
      if (!t) return null;
      return { t, allocations: await fetchTransferAllocations(t.id) };
    },
    [id]
  );
  const [reversing, setReversing] = useState<TransferAllocation | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const minor = Math.round(Number(amount.replace(",", ".")) * 100);
  const amountOk = Number.isFinite(minor) && minor >= 1 && !!reversing && minor <= Number(reversing.amountMinor) - Number(reversing.reversedMinor);
  return (
    <Gate load={load} backLabel="Transfers" onBack={onBack} retry={retry} missing="No transfer has this number among the latest 200 transfers.">
      {({ t, allocations }) => (
        <RecordView
          title={`Transfer #${t.id}`}
          reference={`${t.partyType}:${t.partyId}${t.providerTransferId ? ` · ${t.providerTransferId}` : ""}`}
          backLabel="Transfers"
          onBack={onBack}
          statuses={
            <>
              <Status label="Transfer" value={t.status} status={t.status === "created" ? "approved" : t.status === "failed" || t.status === "unknown" ? "rejected" : "pending"} />
              <Status label="Reversed" value={Number(t.reversedMinor) > 0 ? euro(t.reversedMinor) : "Nothing reversed"} status={Number(t.reversedMinor) > 0 ? "pending" : "draft"} />
            </>
          }
          stats={
            <DetailStats
              items={
                [
                  { label: "Amount", value: euro(t.amountMinor), sub: `Attempt ${t.attempt}` },
                  { label: "Reversed", value: euro(t.reversedMinor), sub: Number(t.reversedMinor) > 0 ? "Recovered towards debt" : "Nothing reversed" },
                  { label: "Bookings", value: String(allocations.length), sub: "In this transfer" },
                  { label: "Created", value: formatDate(t.createdAt), sub: statusLabel(t.status) },
                ]
              }
            />
          }
          aside={
            <>
              <SectionLabel>Transfer</SectionLabel>
              <Facts
                rows={[
                  ["Amount", euro(t.amountMinor)],
                  ["Attempt", String(t.attempt)],
                  ["Created", formatDate(t.createdAt, true)],
                ]}
              />
              <SectionLabel>Related records</SectionLabel>
              {Number(t.settlementId) > 0 ? (
                <AdminButton size="sm" onClick={() => onOpen(`settlement:${t.settlementId}`)}>
                  Open settlement #{t.settlementId}
                </AdminButton>
              ) : (
                <p className="adm-note">Not linked to a settlement.</p>
              )}
            </>
          }
        >
          {t.error && (
            <p className="adm-note" role="note" style={{ color: "var(--color-danger)" }}>
              Provider error: {t.error}
            </p>
          )}
          <SectionLabel>Bookings in this transfer ({allocations.length})</SectionLabel>
          <p className="adm-note">Allocation rows are never edited; a reversal is recorded beside them and only recovers towards this partner's open debt.</p>
          {allocations.length === 0 ? (
            <p className="adm-note">No allocations recorded.</p>
          ) : (
            <Table caption="Transfer allocations" head={["Booking", "Kind", "Amount", "Reversed", ""]}>
              {allocations.map((a) => {
                const key = orderKey(a.sourceType, a.sourceRef);
                const reversible = Number(a.amountMinor) > Number(a.reversedMinor) && Number(a.amountMinor) > 0;
                return (
                  <tr key={a.id}>
                    <td data-label="Booking">
                      {key ? (
                        <button type="button" className="adm-row-button" onClick={() => onOpen(key)}>
                          <span className="adm-cell-title">
                            {a.sourceType} {a.sourceRef}
                          </span>
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label="Kind">{a.kind}</td>
                    <td data-label="Amount">{euro(a.amountMinor)}</td>
                    <td data-label="Reversed">{euro(a.reversedMinor)}</td>
                    <td>
                      {reversible && (
                        <AdminButton
                          size="sm"
                          onClick={() => {
                            setReversing(a);
                            setAmount("");
                            setReason("");
                          }}
                          aria-label={`Reverse part of ${a.sourceRef ?? "this allocation"}`}
                        >
                          Reverse part…
                        </AdminButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
          <ConfirmDialog
            open={!!reversing}
            title={`Reverse part of ${reversing?.sourceRef ?? "this allocation"}?`}
            message={`Takes money back from ${t.partyType}:${t.partyId}'s Stripe account towards their open partner debt — never more than this booking's ${euro(Number(reversing?.amountMinor ?? 0) - Number(reversing?.reversedMinor ?? 0))} still unreversed, and never another partner's money. Moves real money in Stripe (test mode until go-live).`}
            confirmLabel="Reverse"
            confirmDisabled={!amountOk || reason.trim().length < 5}
            onConfirm={async () => {
              const r = await reverseTransferAllocation(reversing!.id, minor, reason.trim());
              setReversing(null);
              toast.success(`Recovered ${euro(r.recoveredMinor)}; still owed ${euro(r.unrecoveredMinor)}`);
              retry();
            }}
            onCancel={() => setReversing(null)}
          >
            <div className="adm-field" style={{ marginTop: 12 }}>
              <label htmlFor="fin-reverse-amount">
                Amount to reverse (€) <span aria-hidden="true">*</span>
              </label>
              <input id="fin-reverse-amount" className="adm-input" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 160 }} />
            </div>
            <ReasonField value={reason} onChange={setReason} />
          </ConfirmDialog>
          <SectionLabel>History</SectionLabel>
          <ObjectActivity objectIds={[String(t.id), t.partyId]} note="Shows audited entries for this transfer or partner." />
        </RecordView>
      )}
    </Gate>
  );
}

// --- payment event --------------------------------------------------------------

const EVENT_LABEL: Record<string, string> = {
  manual_review: "Needs review",
  resolved: "Resolved",
  failed: "Failed — will retry",
  processed: "Processed",
  ignored: "Stored, no action",
  received: "Received",
  processing: "Processing",
};
const eventTone = (s: string) => (s === "processed" ? "approved" : s === "manual_review" || s === "failed" ? "rejected" : "pending");

function EventRecord({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (key: string) => void }) {
  const toast = useToast();
  const [load, retry] = useLoad<WebhookEventRow>(async () => (await fetchWebhookEvents()).find((e) => String(e.id) === id) ?? null, [id]);
  const [replaying, setReplaying] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Gate load={load} backLabel="Payment events" onBack={onBack} retry={retry} missing="No payment event has this number among the latest 200 events.">
      {(e) => {
        const sum = e.summary as { object?: string; id?: string; amount?: number; currency?: string; status?: string; payment_status?: string; payment_intent?: string; metadata?: { type?: string; ref?: string } };
        const key = orderKey(sum.metadata?.type, sum.metadata?.ref);
        const reconciliation = (e.lastError ?? "").startsWith("Checkout reconciliation failed");
        const canReplay = e.status === "failed" || e.status === "manual_review";
        return (
          <RecordView
            title={e.eventType}
            reference={
              <>
                Payment event #{e.id} · <span className="adm-mono">{e.eventId}</span>
              </>
            }
            backLabel="Payment events"
            onBack={onBack}
            statuses={<Status label="Processing" value={`${EVENT_LABEL[e.status] ?? e.status} (${e.attempts} attempt${e.attempts === 1 ? "" : "s"})`} status={eventTone(e.status)} />}
            actions={
              canReplay ? (
                <AdminButton
                  onClick={() => {
                    setReason("");
                    setReplaying(true);
                  }}
                >
                  Replay event…
                </AdminButton>
              ) : null
            }
            stats={
              <DetailStats
                items={
                  [
                    { label: "Amount", value: sum.amount !== undefined ? euro(sum.amount, sum.currency ?? "EUR") : "—", sub: sum.object ?? undefined },
                    { label: "Received", value: formatDate(e.receivedAt), sub: e.provider },
                    { label: "Processed", value: e.processedAt ? formatDate(e.processedAt) : "Not yet", sub: statusLabel(e.status) },
                  ]
                }
              />
            }
            aside={
              <>
                <SectionLabel>Timing</SectionLabel>
                <Facts
                  rows={[
                    ["Received", formatDate(e.receivedAt, true)],
                    ["Processed", e.processedAt ? formatDate(e.processedAt, true) : "Not processed"],
                    ["Provider", e.provider],
                  ]}
                />
                <SectionLabel>Related records</SectionLabel>
                {key ? (
                  <AdminButton size="sm" onClick={() => onOpen(key)}>
                    Open order {sum.metadata?.type} {sum.metadata?.ref}
                  </AdminButton>
                ) : (
                  <p className="adm-note">This event isn't linked to an order.</p>
                )}
              </>
            }
          >
            {e.lastError && (
              <div className="adm-callout" data-tone="error" role="note" style={{ marginBottom: 12 }}>
                <strong>Why it stopped:</strong> {e.lastError}
              </div>
            )}
            {reconciliation && (
              <section aria-labelledby="fin-recon-h" style={{ border: "1px solid var(--adm-line, var(--color-border))", padding: "12px 14px", marginBottom: 14 }}>
                <h2 id="fin-recon-h" className="adm-section-label" style={{ marginTop: 0 }}>
                  Checkout didn't match what was agreed — how to investigate
                </h2>
                <ol style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.55 }}>
                  <li>Nothing was marked paid. The order below is still pending, and the customer sees "Your payment needs a quick check" on their confirmation page.</li>
                  <li>Compare what Stripe reports here ({euro(sum.amount, sum.currency ?? "EUR")}) with the agreed amount in the reason above, and open the order to see its payment record (normally none yet).</li>
                  <li>Look up session <span className="adm-mono">{sum.id ?? "—"}</span> in the Stripe Dashboard to see what the customer was actually charged.</li>
                  <li>Replaying re-checks against the same agreement, so it can't confirm a genuine mismatch — there is deliberately no override. If the charge is wrong, refund it in the Stripe Dashboard, then open the payment review and use <strong>Recheck with Stripe</strong> to record the refund and close it.</li>
                  <li>Contact the customer with the order reference. The payment review shows whether their place is still held and until when.</li>
                </ol>
              </section>
            )}
            <SectionLabel>What Stripe sent (stored summary)</SectionLabel>
            <Facts
              rows={[
                ["Object", sum.object ? `${sum.object} ${sum.id ?? ""}` : null],
                ["Amount", sum.amount !== undefined ? euro(sum.amount, sum.currency ?? "EUR") : null],
                ["Payment status at Stripe", sum.payment_status ?? null],
                ["Object status", sum.status ?? null],
                ["Payment intent", sum.payment_intent ? <span className="adm-mono">{sum.payment_intent}</span> : null],
                ["Order", sum.metadata?.type ? `${sum.metadata.type} ${sum.metadata.ref ?? ""}` : null],
              ]}
            />
            <p className="adm-note">Only identifiers, amounts and statuses are stored — never card or personal data.</p>
            <ConfirmDialog
              open={replaying}
              title={`Replay ${e.eventType}?`}
              message="Re-fetches this event from Stripe and processes it again. Handlers are idempotent, so nothing is applied twice. A payment that doesn't match its checkout agreement goes back to Needs review."
              confirmLabel="Replay event"
              tone="neutral"
              confirmDisabled={reason.trim().length < 5}
              onConfirm={async () => {
                const r = await replayWebhookEvent(e.id, reason.trim());
                setReplaying(false);
                toast.success(`Replayed: ${r.outcome}`);
                retry();
              }}
              onCancel={() => setReplaying(false)}
            >
              <ReasonField value={reason} onChange={setReason} />
            </ConfirmDialog>
            <SectionLabel>History</SectionLabel>
            <ObjectActivity objectIds={[e.eventId]} note="Replays are recorded with their reason." />
          </RecordView>
        );
      }}
    </Gate>
  );
}

// --- refund -----------------------------------------------------------------------

function RefundRecord({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (key: string) => void }) {
  const [load, retry] = useLoad<RefundRow>(async () => (await fetchRefunds()).find((r) => String(r.id) === id) ?? null, [id]);
  return (
    <Gate load={load} backLabel="Refunds" onBack={onBack} retry={retry} missing="No refund has this number among the latest 200 refunds.">
      {(r) => {
        const key = orderKey(r.source_type, r.source_ref);
        return (
          <RecordView
            title={`Refund #${r.id}`}
            reference={`${r.source_type} ${r.source_ref}`}
            backLabel="Refunds"
            onBack={onBack}
            statuses={
              <>
                <Status label="Refund" value={r.status} status={r.status === "succeeded" || r.status === "reconciled" ? "approved" : r.status === "failed" ? "rejected" : "pending"} />
                <Status label="Kind" value={r.kind} status="draft" />
              </>
            }
            stats={
              <DetailStats
                items={
                  [
                    { label: "Amount", value: euro(r.amount_minor, r.currency ?? "EUR"), sub: statusLabel(r.status) },
                    { label: "Borne by", value: statusLabel(r.responsible), sub: r.origin === "in_app" ? "Issued in HelloCircle" : r.origin === "provider" ? "Made at Stripe" : undefined },
                    { label: "Created", value: formatDate(r.created_at), sub: `${r.source_type} ${r.source_ref}` },
                  ]
                }
              />
            }
            aside={
              <>
                <SectionLabel>Related records</SectionLabel>
                {key ? (
                  <AdminButton size="sm" onClick={() => onOpen(key)}>
                    Open order {r.source_type} {r.source_ref}
                  </AdminButton>
                ) : (
                  <p className="adm-note">No linked order.</p>
                )}
              </>
            }
          >
            <SectionLabel>Refund</SectionLabel>
            <Facts
              rows={[
                ["Amount", euro(r.amount_minor, r.currency ?? "EUR")],
                ["Origin", r.origin === "in_app" ? "Issued in HelloCircle" : r.origin === "provider" ? "Made at Stripe, reconciled here" : r.origin],
                ["Borne by", r.responsible],
                ["Reason", r.reason],
                ["Stripe refund", r.provider_refund_id ? <span className="adm-mono">{r.provider_refund_id}</span> : null],
                ["Created", formatDate(r.created_at, true)],
              ]}
            />
            <SectionLabel>History</SectionLabel>
            <ObjectActivity objectIds={[r.source_ref]} note="Refunds issued in HelloCircle are audited against the order." />
          </RecordView>
        );
      }}
    </Gate>
  );
}

// --- dispute ------------------------------------------------------------------------

function DisputeRecord({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (key: string) => void }) {
  const toast = useToast();
  const [load, retry] = useLoad<DisputeRow>(async () => (await fetchDisputes()).find((d) => String(d.id) === id) ?? null, [id]);
  const [deciding, setDeciding] = useState<"partner" | "platform" | null>(null);
  const [reason, setReason] = useState("");
  return (
    <Gate load={load} backLabel="Disputes" onBack={onBack} retry={retry} missing="No dispute has this number among the latest 200 disputes.">
      {(d) => {
        const key = orderKey(d.source_type, d.source_ref);
        const decidable = d.status === "lost" && d.recovery_status === "pending";
        return (
          <RecordView
            title={`Dispute ${d.provider_dispute_id}`}
            reference={d.source_type ? `${d.source_type} ${d.source_ref}` : "Not matched to an order"}
            backLabel="Disputes"
            onBack={onBack}
            statuses={
              <>
                <Status label="Dispute" value={d.status} status={d.status === "won" ? "approved" : d.status === "lost" ? "rejected" : "pending"} />
                <Status label="Recovery" value={`${d.recovery_status}${d.responsible ? ` (${d.responsible})` : ""}`} status={d.recovery_status === "pending" ? "pending" : "approved"} />
              </>
            }
            actions={
              decidable ? (
                <>
                  <AdminButton
                    onClick={() => {
                      setReason("");
                      setDeciding("platform");
                    }}
                  >
                    HelloCircle absorbs…
                  </AdminButton>
                  <AdminButton
                    variant="danger"
                    onClick={() => {
                      setReason("");
                      setDeciding("partner");
                    }}
                  >
                    Recover from partner…
                  </AdminButton>
                </>
              ) : null
            }
            stats={
              <DetailStats
                items={
                  [
                    { label: "Amount", value: euro(d.amount_minor, d.currency ?? "EUR"), sub: d.reason },
                    { label: "Evidence due", value: d.evidence_due_by ? formatDate(d.evidence_due_by) : "—", sub: dueLabel(d.evidence_due_by) ?? undefined },
                    { label: "Stripe status", value: statusLabel(d.status), sub: `Recovery: ${statusLabel(d.recovery_status)}` },
                  ]
                }
              />
            }
            aside={
              <>
                <SectionLabel>Related records</SectionLabel>
                {key ? (
                  <AdminButton size="sm" onClick={() => onOpen(key)}>
                    Open order {d.source_type} {d.source_ref}
                  </AdminButton>
                ) : (
                  <p className="adm-note">Not matched to an order.</p>
                )}
              </>
            }
          >
            <SectionLabel>Dispute</SectionLabel>
            <Facts
              rows={[
                ["Amount", euro(d.amount_minor, d.currency ?? "EUR")],
                ["Card network reason", d.reason],
                ["Evidence due", d.evidence_due_by ? formatDate(d.evidence_due_by, true) : null],
                ["Payment intent", d.payment_intent_id ? <span className="adm-mono">{d.payment_intent_id}</span> : null],
                ["Opened", d.created_at ? formatDate(d.created_at, true) : null],
              ]}
            />
            {!decidable && d.status !== "lost" && <p className="adm-note">A recovery decision is only possible once the dispute is lost.</p>}
            <ConfirmDialog
              open={!!deciding}
              title={deciding === "partner" ? `Recover ${euro(d.amount_minor)} from the partner?` : `Have HelloCircle absorb ${euro(d.amount_minor)}?`}
              message={
                deciding === "partner"
                  ? "The loss is recovered from the partner's available balance (their own money only). This decision is final."
                  : "HelloCircle bears the loss; the partner's balance isn't touched. This decision is final."
              }
              confirmLabel={deciding === "partner" ? "Recover from partner" : "HelloCircle absorbs"}
              tone={deciding === "partner" ? "danger" : "neutral"}
              confirmDisabled={reason.trim().length < 5}
              onConfirm={async () => {
                await decideDisputeRecovery(d.id, deciding!, reason.trim());
                setDeciding(null);
                toast.success("Recovery decision saved");
                retry();
              }}
              onCancel={() => setDeciding(null)}
            >
              <ReasonField value={reason} onChange={setReason} />
            </ConfirmDialog>
            <SectionLabel>History</SectionLabel>
            <ObjectActivity objectIds={[String(d.id)]} note="Recovery decisions are audited with their reason." />
          </RecordView>
        );
      }}
    </Gate>
  );
}

// --- order (payment hub) ----------------------------------------------------------------

function OrderRecord({ type, refId, onBack, onOpen, backLabel }: { type: string; refId: string; onBack: () => void; onOpen: (key: string) => void; backLabel: string }) {
  const toast = useToast();
  const [load, retry] = useLoad<{ payments: PaymentRecordRow[]; allocation: OrderAllocation | null; refunds: RefundRow[]; disputes: DisputeRow[] }>(
    async () => {
      const [payments, allocation, refunds, disputes] = await Promise.all([
        fetchPaymentRecords(refId),
        fetchOrderAllocation(type, refId).catch((e) => {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }),
        fetchRefunds(),
        fetchDisputes(),
      ]);
      return {
        payments: payments.filter((p) => p.source_type === type && p.source_ref === refId),
        allocation,
        refunds: refunds.filter((r) => r.source_type === type && r.source_ref === refId),
        disputes: disputes.filter((d) => d.source_type === type && d.source_ref === refId),
      };
    },
    [type, refId]
  );
  const [refunding, setRefunding] = useState(false);
  const [amount, setAmount] = useState("");
  const [responsible, setResponsible] = useState<"platform" | "partner" | "customer">("platform");
  const [reason, setReason] = useState("");
  const amountMinor = amount.trim() ? Math.round(Number(amount.replace(",", ".")) * 100) : undefined;
  const amountOk = amountMinor === undefined || (Number.isFinite(amountMinor) && amountMinor >= 1);
  return (
    <Gate load={load} backLabel={backLabel} onBack={onBack} retry={retry} missing="No order has this reference.">
      {({ payments, allocation, refunds, disputes }) => {
        const pay = payments[0];
        const refunded = refunds.filter((r) => r.status !== "failed").reduce((a, r) => a + Number(r.amount_minor), 0);
        const refundable = !!pay && pay.status === "paid" && type !== "pass";
        return (
          <RecordView
            title={`${type[0].toUpperCase()}${type.slice(1)} ${refId}`}
            reference="Order payment record"
            backLabel={backLabel}
            onBack={onBack}
            statuses={
              <>
                <Status label="Payment" value={pay ? pay.status : "No payment recorded"} status={pay?.status === "paid" ? "approved" : pay ? "pending" : "draft"} />
                <Status label="Refunded" value={refunded > 0 ? euro(refunded) : "Nothing refunded"} status={refunded > 0 ? "pending" : "draft"} />
                <Status label="Disputes" value={disputes.length ? `${disputes.length} open or past` : "None"} status={disputes.length ? "rejected" : "draft"} />
                <Status label="Release to partner" value={allocation ? (allocation.releases.length ? "Released" : "Not released yet") : "No allocation frozen"} status={allocation?.releases.length ? "approved" : "draft"} />
              </>
            }
            actions={
              refundable ? (
                <AdminButton
                  variant="danger"
                  onClick={() => {
                    setAmount("");
                    setReason("");
                    setResponsible("platform");
                    setRefunding(true);
                  }}
                >
                  Refund…
                </AdminButton>
              ) : null
            }
            stats={
              <DetailStats
                items={
                  [
                    { label: "Paid", value: pay ? euro(pay.amount_minor, pay.currency) : "—", sub: pay ? statusLabel(pay.status) : "No payment recorded" },
                    { label: "Refunded", value: euro(refunded), sub: refunds.length ? `${refunds.length} refund${refunds.length === 1 ? "" : "s"}` : "None" },
                    { label: "Disputes", value: String(disputes.length), sub: disputes.length ? "See below" : "None" },
                  ]
                }
              />
            }
            aside={
              <>
                <SectionLabel>Who is owed what</SectionLabel>
                {allocation ? (
                  <>
                    <Table caption="Allocation" head={["Share", "Party", "Amount"]}>
                      {allocation.lines.map((l, i) => (
                        <tr key={i}>
                          <td data-label="Share">{l.role}</td>
                          <td data-label="Party">{l.partyType ? `${l.partyType}:${l.partyId}` : "HelloCircle"}</td>
                          <td data-label="Amount">{euro(l.amountMinor)}</td>
                        </tr>
                      ))}
                    </Table>
                    <p className="adm-note" style={{ marginTop: 6 }}>
                      {allocation.releases.length ? `Released: ${allocation.releases.map((r) => `${euro(r.releasedMinor)} to ${r.partyType}:${r.partyId}`).join("; ")}.` : "Not released for settlement yet."}
                    </p>
                  </>
                ) : (
                  <p className="adm-note">No allocation was frozen for this order (it is frozen when a payment is confirmed with the settlement ledger on).</p>
                )}
              </>
            }
          >
            {!pay && (
              <p className="adm-note" role="note">
                No payment has been recorded for this order. Either it was free or paid at the venue, it hasn't been paid, or its payment event is waiting in Payment events → Needs review.
              </p>
            )}
            <SectionLabel>Payment</SectionLabel>
            {pay ? (
              <Facts
                rows={[
                  ["Amount", euro(pay.amount_minor, pay.currency)],
                  ["Provider", pay.provider],
                  ["Checkout session", pay.checkout_session_id ? <span className="adm-mono">{pay.checkout_session_id}</span> : null],
                  ["Payment intent", pay.payment_intent_id ? <span className="adm-mono">{pay.payment_intent_id}</span> : null],
                  ["Estimated processing fee", pay.fee_estimate_minor !== null ? euro(pay.fee_estimate_minor) : null],
                  ["Recorded", formatDate(pay.created_at, true)],
                ]}
              />
            ) : (
              <p className="adm-note">None.</p>
            )}
            <SectionLabel>Refunds ({refunds.length})</SectionLabel>
            {refunds.length === 0 ? (
              <p className="adm-note">None.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {refunds.map((r) => (
                  <li key={r.id}>
                    <AdminButton size="sm" onClick={() => onOpen(`refund:${r.id}`)}>
                      Refund #{r.id} · {euro(r.amount_minor)} · {r.status}
                    </AdminButton>
                  </li>
                ))}
              </ul>
            )}
            <SectionLabel>Disputes ({disputes.length})</SectionLabel>
            {disputes.length === 0 ? (
              <p className="adm-note">None.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {disputes.map((d) => (
                  <li key={d.id}>
                    <AdminButton size="sm" onClick={() => onOpen(`dispute:${d.id}`)}>
                      Dispute {d.provider_dispute_id} · {d.status}
                    </AdminButton>
                  </li>
                ))}
              </ul>
            )}
            <ConfirmDialog
              open={refunding}
              title={`Refund ${type} ${refId}?`}
              message={`${amountMinor ? `Refunds ${euro(amountMinor)}` : "Refunds everything still refundable"} to the customer's card through Stripe (test mode until go-live). The server refuses more than what's left to refund.`}
              confirmLabel="Refund"
              confirmDisabled={!amountOk || reason.trim().length < 5}
              onConfirm={async () => {
                const r = await issueAdminRefund({ sourceType: type, ref: refId, amountMinor, reason: reason.trim(), responsible });
                setRefunding(false);
                toast.success(`Refunded ${euro(r.amountMinor)}${r.full ? " — order fully refunded" : ""}`);
                retry();
              }}
              onCancel={() => setRefunding(false)}
            >
              <div className="adm-field" style={{ marginTop: 12 }}>
                <label htmlFor="fin-refund-amount">
                  Amount (€) <span style={{ fontWeight: 400 }}>(optional — blank refunds everything still refundable)</span>
                </label>
                <input id="fin-refund-amount" className="adm-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 160 }} aria-invalid={!amountOk || undefined} />
              </div>
              <div className="adm-field" style={{ marginTop: 12 }}>
                <label htmlFor="fin-refund-responsible">Who bears it</label>
                <select id="fin-refund-responsible" className="adm-select" value={responsible} onChange={(e) => setResponsible(e.target.value as typeof responsible)}>
                  <option value="platform">HelloCircle</option>
                  <option value="partner">Partner</option>
                  <option value="customer">Customer</option>
                </select>
              </div>
              <ReasonField value={reason} onChange={setReason} />
            </ConfirmDialog>
            <SectionLabel>History</SectionLabel>
            <ObjectActivity objectIds={[refId]} note="Audited actions on this order (refunds, cancellations)." />
          </RecordView>
        );
      }}
    </Gate>
  );
}

// --- dispatcher ----------------------------------------------------------------------------

// --- payment review (D-10 / D-11) ----------------------------------------------------

export const REVIEW_REASON: Record<string, string> = {
  amount_mismatch: "Amount differs from the agreed amount",
  currency_mismatch: "Currency differs from the agreed currency",
  association_unverified: "Can't be tied to an order",
  org_suspended: "Organisation suspended",
  capacity_unavailable: "Place no longer available",
  listing_unavailable: "Listing or session no longer sellable",
  after_start: "Paid after the start",
  mid_programme: "Programme already started",
  order_cancelled: "Order already cancelled",
  provider_state: "Refund, dispute or unsettled charge at Stripe",
};
export const HOLD_LABEL: Record<string, string> = { held: "Place held", none: "No place held", expired: "Hold expired — place released", released: "Place released", consumed: "Place used by the confirmed booking" };
export const AUTO_REFUND_LABEL: Record<string, string> = {
  not_applicable: "Not an automatic-refund case",
  pending_check: "Waiting to be checked",
  checking: "Being checked",
  disabled: "Switched off — finance decides",
  ineligible: "Not made — a precondition didn't hold",
  requested: "Requested from Stripe",
  provider_pending: "Pending at Stripe",
  succeeded: "Refunded",
  failed: "Refused by Stripe — not retried",
  uncertain: "Outcome unknown — recheck before anything else",
};
const ALERT_LABEL: Record<string, string> = {
  parked: "Finance alerted",
  urgent: "Urgent alert (starts soon / started)",
  halfway: "Halfway-to-deadline alert",
  expired: "Deadline alert — place released",
  shortened: "Urgent alert — session moved, hold ended",
  unfulfilled: "Paid order not fulfilled",
  auto_refund_ineligible: "Automatic refund not made",
  refund_failed: "Automatic refund failed",
  refund_uncertain: "Automatic refund outcome unknown",
};

/** The order's own state in plain words (kept separate from payment, capacity and review). */
export function bookingState(order: PaymentReviewDetail["order"]): string {
  if (!order) return "No order";
  if (order.missing) return "Order not found";
  if (order.paymentStatus === "refunded") return "Cancelled — refunded";
  if (order.status === "cancelled") return order.paymentStatus === "paid" ? "Cancelled — payment kept for refund" : "Cancelled";
  if (order.paymentStatus === "paid") return "Confirmed";
  if (order.paymentStatus === "pending") return "Not confirmed — payment held";
  return order.paymentStatus ?? "—";
}

function ReviewRecord({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (key: string) => void }) {
  const toast = useToast();
  const [load, retry] = useLoad<PaymentReviewDetail>(() => fetchPaymentReview(id), [id]);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Gate load={load} backLabel="Payment reviews" onBack={onBack} retry={retry} missing="No payment review has this number.">
      {({ review: r, order, payment, refunds, events, alerts }) => {
        const cur = r.receivedCurrency ?? "EUR";
        const key = orderKey(r.sourceType, r.sourceRef);
        const urgent = r.urgency === "within_lead" || r.urgency === "after_start";
        return (
          <RecordView
            title={`Payment review #${r.id}`}
            reference={
              <>
                {r.sourceType && r.sourceRef ? `${r.sourceType} ${r.sourceRef}` : "No order"} · <span className="adm-mono">{r.checkoutSessionId}</span>
              </>
            }
            backLabel="Payment reviews"
            onBack={onBack}
            statuses={
              <>
                <Status label="Review" value={r.status === "open" ? "Open" : `Closed — ${r.resolution ?? "resolved"}`} status={r.status === "open" ? "pending" : "approved"} />{" "}
                <Status label="Payment at Stripe" value="Received (verified)" status="approved" />{" "}
                <Status label="Booking" value={bookingState(order)} status={order?.paymentStatus === "paid" && order?.status !== "cancelled" ? "approved" : "pending"} />{" "}
                <Status label="Capacity" value={HOLD_LABEL[r.holdStatus] ?? r.holdStatus} status={r.holdStatus === "held" ? "pending" : "neutral"} />
              </>
            }
            actions={
              <AdminButton
                onClick={() => {
                  setReason("");
                  setOpen(true);
                }}
              >
                Recheck with Stripe…
              </AdminButton>
            }
            stats={
              <DetailStats
                items={
                  [
                    { label: "Received", value: r.receivedMinor !== null ? euro(r.receivedMinor, cur) : "Unknown", sub: "At Stripe" },
                    { label: "Agreed", value: r.agreedMinor !== null ? euro(r.agreedMinor, r.agreedCurrency ?? "EUR") : "—", sub: "At checkout" },
                    { label: "Place held", value: r.reviewHoldUntil ? dueLabel(r.reviewHoldUntil) ?? "—" : "Not held", sub: r.reviewHoldUntil ? `until ${formatDate(r.reviewHoldUntil, true)}` : undefined },
                    { label: "Refunded so far", value: euro(refunds.filter((x) => x.status === "succeeded" || x.status === "reconciled").reduce((a, x) => a + Number(x.amountMinor), 0), cur), sub: AUTO_REFUND_LABEL[r.autoRefund] ?? r.autoRefund },
                  ]
                }
              />
            }
            aside={
              <>
                <SectionLabel>Refunds</SectionLabel>
                {refunds.length ? (
                  <Table caption="Refunds for this order" head={["Amount", "Status", "Origin", "Stripe refund"]}>
                    {refunds.map((x) => (
                      <tr key={x.id}>
                        <td data-label="Amount">{euro(x.amountMinor, x.currency)}</td>
                        <td data-label="Status">{x.status}{x.lastError ? <div className="adm-note">{x.lastError}</div> : null}</td>
                        <td data-label="Origin">{x.origin}</td>
                        <td data-label="Stripe refund"><span className="adm-mono">{x.providerRefundId ?? "—"}</span></td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <p className="adm-note">No refund recorded.</p>
                )}
                <SectionLabel>Payment events</SectionLabel>
                {events.length ? (
                  <Table caption="Payment events for this payment" head={["Event", "Status", ""]}>
                    {events.map((e) => (
                      <tr key={e.id}>
                        <td data-label="Event">{e.eventType}<div className="adm-note">{formatDate(e.receivedAt, true)}</div></td>
                        <td data-label="Status">{EVENT_LABEL[e.status] ?? e.status}{e.resolution ? <div className="adm-note">{e.resolution}</div> : null}</td>
                        <td data-label="Open"><AdminButton size="sm" onClick={() => onOpen(`event:${e.id}`)} aria-label={`Open payment event ${e.id}`}>Open</AdminButton></td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <p className="adm-note">No stored events.</p>
                )}
                <SectionLabel>Order</SectionLabel>
                {key && (
                  <AdminButton size="sm" onClick={() => onOpen(key)}>
                    Open order {r.sourceType} {r.sourceRef}
                  </AdminButton>
                )}
              </>
            }
          >
            {urgent && r.status === "open" && (
              <div className="adm-callout" data-tone="error" role="note" style={{ marginBottom: 12 }}>
                <strong>Urgent:</strong> {r.urgency === "after_start" ? "it had already started when the payment arrived" : "it starts within the lead time"}, so no place is held and it can't be confirmed. Contact the customer.
              </div>
            )}
            <div className="adm-callout" role="note" style={{ marginBottom: 12 }}>
              <strong>Why it's here:</strong> {REVIEW_REASON[r.reason] ?? r.reason}
              {r.detail ? ` — ${r.detail}` : ""}
            </div>
            <SectionLabel>Money</SectionLabel>
            <Facts
              rows={[
                ["Received (Stripe)", r.receivedMinor !== null ? euro(r.receivedMinor, cur) : "Unknown"],
                ["Agreed at checkout", r.agreedMinor !== null ? euro(r.agreedMinor, r.agreedCurrency ?? "EUR") : "—"],
                ["Payment record", payment ? `${euro(payment.amountMinor, payment.currency)} · ${payment.status}` : "None (not applied to the order)"],
                ["Refunded so far", euro(refunds.filter((x) => x.status === "succeeded" || x.status === "reconciled").reduce((a, x) => a + Number(x.amountMinor), 0), cur)],
                ["Automatic refund", AUTO_REFUND_LABEL[r.autoRefund] ?? r.autoRefund],
                ["Automatic refund note", r.autoRefundNote],
              ]}
            />
            <SectionLabel>Deadline and booking</SectionLabel>
            <Facts
              rows={[
                ["Flagged", formatDate(r.flaggedAt, true)],
                ["Place held until", r.reviewHoldUntil ? formatDate(r.reviewHoldUntil, true) : "—"],
                ["Starts", r.startAt ? formatDate(r.startAt, true) : "No single start"],
                ["Urgency", r.urgency === "none" ? "—" : r.urgency.replace(/_/g, " ")],
                ["Order total", order && !order.missing ? euro(order.totalMinor ?? 0) : null],
              ]}
            />
            <SectionLabel>Stripe references</SectionLabel>
            <Facts
              rows={[
                ["Checkout session", <span className="adm-mono">{r.checkoutSessionId}</span>],
                ["Payment intent", r.paymentIntentId ? <span className="adm-mono">{r.paymentIntentId}</span> : null],
                ["Charge", r.chargeId ? <span className="adm-mono">{r.chargeId}</span> : null],
                ["Last recheck", r.lastRecheckAt ? `${formatDate(r.lastRecheckAt, true)} — ${r.lastRecheckOutcome ?? ""}` : "Not rechecked yet"],
                ["Closed", r.resolvedAt ? `${formatDate(r.resolvedAt, true)}${r.resolution ? ` — ${r.resolution}` : ""}` : null],
              ]}
            />
            <SectionLabel>Investigation history</SectionLabel>
            <ul className="adm-note" style={{ margin: "0 0 8px", paddingLeft: 18 }}>
              {alerts.map((a) => (
                <li key={a.kind}>{ALERT_LABEL[a.kind] ?? a.kind} — {formatDate(a.createdAt, true)}</li>
              ))}
              {!alerts.length && <li>No alerts yet.</li>}
            </ul>
            <ObjectActivity objectIds={[`review-${r.id}`, ...(r.sourceRef ? [r.sourceRef] : [])]} note="Rechecks, automatic refunds and expiries are recorded with their outcome." />
            <ConfirmDialog
              open={open}
              title="Recheck this payment with Stripe?"
              message="Reads the payment, its refunds and any dispute from Stripe and records what it finds. It never issues a refund, never confirms the booking and never restores it. The review closes only if Stripe shows the full amount refunded, nothing pending and no dispute."
              confirmLabel="Recheck with Stripe"
              tone="neutral"
              confirmDisabled={reason.trim().length < 5}
              onConfirm={async () => {
                const out = await recheckPaymentReview(r.id, reason.trim());
                setOpen(false);
                if (out.outcome === "closed") toast.success(`Closed: ${out.reason}`);
                else toast.success(`Still open: ${out.reason}`);
                retry();
              }}
              onCancel={() => setOpen(false)}
            >
              <ReasonField value={reason} onChange={setReason} />
            </ConfirmDialog>
          </RecordView>
        );
      }}
    </Gate>
  );
}

const BACK_LABEL: Record<string, string> = { settlements: "Settlements", transfers: "Transfers", events: "Payment events", refunds: "Refunds", disputes: "Disputes", reviews: "Payment reviews" };

/** Renders the finance record named by `?record=` (kind:id), or a missing state. */
export function FinanceRecordPage({ record, section, onBack, onOpen }: { record: string; section: string; onBack: () => void; onOpen: (key: string) => void }) {
  const [kind, ...rest] = record.split(":");
  const id = rest.join(":");
  if (kind === "settlement") return <SettlementRecord key={record} id={id} onBack={onBack} onOpen={onOpen} />;
  if (kind === "transfer") return <TransferRecord key={record} id={id} onBack={onBack} onOpen={onOpen} />;
  if (kind === "event") return <EventRecord key={record} id={id} onBack={onBack} onOpen={onOpen} />;
  if (kind === "review") return <ReviewRecord key={record} id={id} onBack={onBack} onOpen={onOpen} />;
  if (kind === "refund") return <RefundRecord key={record} id={id} onBack={onBack} onOpen={onOpen} />;
  if (kind === "dispute") return <DisputeRecord key={record} id={id} onBack={onBack} onOpen={onOpen} />;
  if (kind === "order" && rest.length >= 2) return <OrderRecord key={record} type={rest[0]} refId={rest.slice(1).join(":")} onBack={onBack} onOpen={onOpen} backLabel={BACK_LABEL[section] ?? "Finance"} />;
  return <RecordState state="missing" backLabel={BACK_LABEL[section] ?? "Finance"} onBack={onBack} message="This finance record link isn't recognised." />;
}
