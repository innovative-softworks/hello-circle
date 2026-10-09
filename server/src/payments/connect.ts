import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { postGroup } from "../commerce/ledger.js";
import { NeedsReviewError, ledgerEnabled } from "../commerce/payments.js";
import { resolveRule } from "../commerce/rules.js";
import { partnerBalances } from "../commerce/settlement.js";
import { commerceSwitch } from "../commerce/switches.js";
import { CLIENT_URL } from "../stripe.js";
import { accountStatusFrom, paymentProvider, type ConnectedAccountStatus, type PaymentProvider } from "./provider.js";
import type { IncomingEvent } from "./webhookEvents.js";

// Revenue & Connect Stage 5a — Stripe Connect money movement.
//
// Separate charges and transfers: customers pay HelloCircle's platform
// account; after an order completes and its review period passes it is
// released (Stage 2d), weekly settlement makes it "due", and only then does
// a finance admin's transfer run move the settled net to the partner's
// Express account. Stripe pays it out to their bank on its own schedule
// (mirrored from payout.* events). A negative partner balance (a refund
// after transfer, or a lost dispute the partner is responsible for) is
// recovered by explicitly reversing earlier transfers — never automatically.
//
// Wording rule: delayed transfer isn't escrow and funds aren't safeguarded;
// nothing here (or in the UI copy it feeds) says otherwise.

export class ConnectError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

export type Party = { partyType: "org" | "vendor" | "host"; partyId: string };

const ACCOUNT_FIELDS = `party_type as partyType, party_id as partyId, provider, account_id as accountId, country, details_submitted as detailsSubmitted,
  charges_enabled as chargesEnabled, payouts_enabled as payoutsEnabled, transfers_capability as transfersCapability,
  requirements_due as requirementsDue, disabled_reason as disabledReason, updated_at as updatedAt`;

export interface ConnectedAccountRow {
  partyType: string;
  partyId: string;
  provider: string;
  accountId: string;
  country: string;
  detailsSubmitted: number;
  chargesEnabled: number;
  payoutsEnabled: number;
  transfersCapability: string;
  requirementsDue: string | null;
  disabledReason: string | null;
  updatedAt: string;
}

export const connectEnabled = () => commerceSwitch("commerce.connect_v1");

async function requireConnect(): Promise<PaymentProvider> {
  if (!(await connectEnabled())) throw new ConnectError("Stripe Connect payouts aren't switched on yet", 409);
  const provider = paymentProvider();
  if (!provider) throw new ConnectError("Payments aren't configured on this server", 503);
  return provider;
}

export async function getConnectedAccount(party: Party): Promise<ConnectedAccountRow | undefined> {
  return (await db.prepare(`SELECT ${ACCOUNT_FIELDS} FROM connected_accounts WHERE party_type = ? AND party_id = ?`).get(party.partyType, party.partyId)) as ConnectedAccountRow | undefined;
}

async function applyStatus(s: ConnectedAccountStatus): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE connected_accounts SET details_submitted = ?, charges_enabled = ?, payouts_enabled = ?, transfers_capability = ?, requirements_due = ?, disabled_reason = ?
       WHERE account_id = ?`
    )
    .run(s.detailsSubmitted ? 1 : 0, s.chargesEnabled ? 1 : 0, s.payoutsEnabled ? 1 : 0, s.transfersCapability.slice(0, 20), JSON.stringify(s.requirementsDue).slice(0, 4000), s.disabledReason?.slice(0, 120) ?? null, s.id);
  return r.changes > 0;
}

/** Creates the party's Express account on first use, then returns a
 * Stripe-hosted onboarding link (single use) back to `returnPath`. */
export async function startOnboarding(party: Party, input: { email: string; country: string; returnPath: string; actorId: string }) {
  const provider = await requireConnect();
  if (!/^\/[\w\-/?=&]*$/.test(input.returnPath)) throw new ConnectError("Invalid return path");
  const availability = await resolveRule("availability");
  const allowed = String(availability.values.partnerCountry ?? "IE");
  if (input.country !== allowed) throw new ConnectError(`Payouts are only available to partners in ${allowed} at the moment`, 409);

  let account = await getConnectedAccount(party);
  if (!account) {
    const created = await provider.createConnectedAccount({
      country: input.country,
      email: input.email,
      idempotencyKey: `acct:${party.partyType}:${party.partyId}`,
      metadata: { party_type: party.partyType, party_id: party.partyId },
    });
    await db
      .prepare(`INSERT IGNORE INTO connected_accounts (party_type, party_id, provider, account_id, country) VALUES (?, ?, ?, ?, ?)`)
      .run(party.partyType, party.partyId, provider.name, created.id, input.country);
    await applyStatus(await provider.retrieveConnectedAccount(created.id));
    await writeAudit({ actorUserId: input.actorId, action: "connect.account_created", objectType: `connect_${party.partyType}`, objectId: party.partyId, newValue: { accountId: created.id } });
    account = await getConnectedAccount(party);
  }
  const sep = input.returnPath.includes("?") ? "&" : "?";
  return provider.createOnboardingLink({
    accountId: account!.accountId,
    refreshUrl: `${CLIENT_URL}${input.returnPath}${sep}payouts=refresh`,
    returnUrl: `${CLIENT_URL}${input.returnPath}${sep}payouts=return`,
  });
}

export async function refreshAccount(party: Party) {
  const provider = await requireConnect();
  const account = await getConnectedAccount(party);
  if (!account) throw new ConnectError("No payout account yet", 404);
  await applyStatus(await provider.retrieveConnectedAccount(account.accountId));
  return getConnectedAccount(party);
}

export async function dashboardLink(party: Party) {
  const provider = await requireConnect();
  const account = await getConnectedAccount(party);
  if (!account) throw new ConnectError("No payout account yet", 404);
  if (!account.detailsSubmitted) throw new ConnectError("Finish setting up payouts first", 409);
  return provider.createDashboardLink(account.accountId);
}

/** Why a party can't receive a transfer yet (empty = ready). */
export async function payoutReadiness(party: Party): Promise<string[]> {
  const reasons: string[] = [];
  const account = await getConnectedAccount(party);
  if (!account) reasons.push("No payout account connected");
  else {
    if (account.transfersCapability !== "active") reasons.push("Payout account can't receive transfers yet (verification incomplete)");
    if (!account.payoutsEnabled) reasons.push("Payouts to the bank account aren't enabled yet");
  }
  // Trader details (DSA art. 30 / DAC7) are a precondition for being paid.
  if (party.partyType === "vendor") reasons.push("Account isn't linked to an organisation");
  else {
    const t = (await db.prepare(`SELECT self_certified_at as sc, verification_status as vs FROM trader_profiles WHERE party_type = ? AND party_id = ?`).get(party.partyType, party.partyId)) as
      | { sc: string | null; vs: string }
      | undefined;
    if (!t?.sc) reasons.push("Trader details not completed and self-certified");
    else if (t.vs === "rejected") reasons.push("Trader details need changes");
  }
  return reasons;
}

// --- transfers -------------------------------------------------------------------

/** Definitive provider refusals (won't succeed on an identical retry) vs.
 * outcomes we didn't see (network/API errors — retry with the same key). */
function isDefinitive(e: unknown): boolean {
  const err = e as { type?: string; code?: string; statusCode?: number };
  if (err?.type === "StripeConnectionError" || err?.type === "StripeAPIError" || (err?.statusCode ?? 0) >= 500) return false;
  return !!(err?.code || err?.type === "StripeInvalidRequestError" || err?.type === "StripePermissionError");
}

interface DueSettlement {
  id: number;
  partyType: Party["partyType"];
  partyId: string;
  netMinor: number;
  currency: string;
  runKey: string;
}

async function transferOne(provider: PaymentProvider, s: DueSettlement, actorId: string): Promise<{ status: "created" | "failed" | "unknown"; transferId?: string; error?: string }> {
  const account = (await getConnectedAccount(s))!;
  // Claim: reuse an attempt whose outcome we never saw; otherwise open the next one.
  const claim = await db.transaction(async (tx) => {
    const st = (await tx.prepare(`SELECT status FROM settlements WHERE id = ? FOR UPDATE`).get(s.id)) as { status: string } | undefined;
    if (st?.status !== "due") return null;
    const last = (await tx.prepare(`SELECT id, attempt, status, idempotency_key as k FROM transfers WHERE settlement_id = ? ORDER BY attempt DESC LIMIT 1`).get(s.id)) as
      | { id: number; attempt: number; status: string; k: string }
      | undefined;
    if (last && (last.status === "unknown" || last.status === "pending")) return { rowId: last.id, key: last.k };
    if (last?.status === "created") return null;
    const attempt = (last?.attempt ?? 0) + 1;
    const key = `settlement:${s.id}:${attempt}`;
    const r = await tx
      .prepare(
        `INSERT INTO transfers (settlement_id, attempt, idempotency_key, party_type, party_id, destination_account, amount_minor, currency, transfer_group, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(s.id, attempt, key, s.partyType, s.partyId, account.accountId, s.netMinor, s.currency, `settlement:${s.id}`, actorId);
    return { rowId: Number(r.lastInsertRowid), key };
  });
  if (!claim) return { status: "failed", error: "Settlement is no longer due" };

  try {
    const t = await provider.createTransfer({
      amountMinor: s.netMinor,
      currency: s.currency,
      destinationAccountId: account.accountId,
      transferGroup: `settlement:${s.id}`,
      idempotencyKey: claim.key,
      metadata: { settlement_id: String(s.id), run_key: s.runKey, party_type: s.partyType, party_id: s.partyId },
    });
    await db.transaction(async (tx) => {
      const g = (await ledgerEnabled())
        ? await postGroup(tx, {
            idempotencyKey: `transfer:${s.id}`,
            sourceType: "transfer",
            sourceId: String(s.id),
            description: `Transfer to ${s.partyType} ${s.partyId} (settlement ${s.id})`,
            basis: "actual",
            currency: s.currency,
            lines: [
              { account: "settlement_payable", amountMinor: s.netMinor, partyType: s.partyType, partyId: s.partyId, memo: "transferred" },
              { account: "stripe_clearing", amountMinor: -s.netMinor, memo: `transfer ${t.id}` },
            ],
            createdBy: actorId,
          })
        : null;
      await tx.prepare(`UPDATE transfers SET status = 'created', provider_transfer_id = ?, error = NULL, ledger_group_id = ? WHERE id = ?`).run(t.id, g?.groupId ?? null, claim.rowId);
      await tx.prepare(`UPDATE settlements SET status = 'transferred', transfer_id = ?, row_version = row_version + 1 WHERE id = ? AND status = 'due'`).run(t.id, s.id);
    });
    return { status: "created", transferId: t.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = isDefinitive(e) ? "failed" : "unknown";
    await db.prepare(`UPDATE transfers SET status = ?, error = ? WHERE id = ?`).run(status, message.slice(0, 2000), claim.rowId);
    return { status, error: message };
  }
}

/** Transfers every "due" settlement whose partner is ready. Dry run (the
 * default in the API) only reports what would happen. */
export async function runTransfers(input: { dryRun: boolean; actorId: string; reason: string; limit?: number }) {
  if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new ConnectError("A reason (at least 5 characters) is required");
  const provider = await requireConnect();
  const due = (await db
    .prepare(
      `SELECT s.id, s.party_type as partyType, s.party_id as partyId, s.net_minor as netMinor, s.currency, r.run_key as runKey
       FROM settlements s JOIN settlement_runs r ON r.id = s.run_id WHERE s.status = 'due' AND s.net_minor > 0 ORDER BY s.id LIMIT ?`
    )
    .all(Math.min(Math.max(Number(input.limit) || 100, 1), 500))) as DueSettlement[];
  const out = { dryRun: input.dryRun, transferred: [] as { settlementId: number; amountMinor: number; transferId?: string }[], held: [] as { settlementId: number; reasons: string[] }[], failed: [] as { settlementId: number; status: string; error: string }[] };
  for (const s of due) {
    s.netMinor = Number(s.netMinor);
    const reasons = await payoutReadiness(s);
    if (reasons.length) {
      out.held.push({ settlementId: s.id, reasons });
      continue;
    }
    if (input.dryRun) {
      out.transferred.push({ settlementId: s.id, amountMinor: s.netMinor });
      continue;
    }
    const r = await transferOne(provider, s, input.actorId);
    if (r.status === "created") out.transferred.push({ settlementId: s.id, amountMinor: s.netMinor, transferId: r.transferId });
    else out.failed.push({ settlementId: s.id, status: r.status, error: r.error ?? "" });
  }
  if (!input.dryRun) {
    await writeAudit({ actorUserId: input.actorId, action: "connect.transfers_run", objectType: "transfers", objectId: new Date().toISOString(), newValue: { transferred: out.transferred.length, held: out.held.length, failed: out.failed.length }, reason: input.reason.trim() });
  }
  return out;
}

// --- recovery by transfer reversal ---------------------------------------------------

/** Recovers a negative partner balance (refund after transfer, or a lost
 * dispute the partner is responsible for) by reversing their most recent
 * transfers, up to the amount owed. Explicit and audited — never automatic. */
export async function recoverByReversal(party: Party, input: { actorId: string; reason: string; maxMinor?: number }) {
  if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new ConnectError("A reason (at least 5 characters) is required");
  const provider = await requireConnect();
  if (!(await ledgerEnabled())) throw new ConnectError("Turn on the financial ledger switch first", 409);

  // Plan under a per-party lock, counting reversals already in flight.
  const plan = await db.transaction(async (tx) => {
    const acct = await tx.prepare(`SELECT account_id FROM connected_accounts WHERE party_type = ? AND party_id = ? FOR UPDATE`).get(party.partyType, party.partyId);
    if (!acct) throw new ConnectError("This partner has no payout account", 404);
    const available = (await partnerBalances(party)).availableMinor;
    const inFlight = (await tx
      .prepare(`SELECT COALESCE(SUM(r.amount_minor), 0) as s FROM transfer_reversals r JOIN transfers t ON t.id = r.transfer_id WHERE t.party_type = ? AND t.party_id = ? AND r.status IN ('pending','unknown')`)
      .get(party.partyType, party.partyId)) as { s: number | string };
    let owed = -available - Number(inFlight.s);
    if (input.maxMinor !== undefined) owed = Math.min(owed, Math.floor(input.maxMinor));
    if (owed <= 0) throw new ConnectError("This partner doesn't owe anything to recover", 409);
    const transfers = (await tx
      .prepare(`SELECT id, provider_transfer_id as providerId, amount_minor as amount, reversed_minor as reversed FROM transfers WHERE party_type = ? AND party_id = ? AND status IN ('created','partially_reversed') ORDER BY id DESC`)
      .all(party.partyType, party.partyId)) as { id: number; providerId: string; amount: number | string; reversed: number | string }[];
    const steps: { reversalId: number; transferRowId: number; providerTransferId: string; amountMinor: number; key: string }[] = [];
    for (const t of transfers) {
      if (owed <= 0) break;
      const room = Number(t.amount) - Number(t.reversed);
      if (room <= 0) continue;
      const amt = Math.min(room, owed);
      const n = ((await tx.prepare(`SELECT COUNT(*) as n FROM transfer_reversals WHERE transfer_id = ?`).get(t.id)) as { n: number }).n;
      const key = `reversal:${t.id}:${Number(n) + 1}`;
      const r = await tx
        .prepare(`INSERT INTO transfer_reversals (transfer_id, idempotency_key, amount_minor, reason, note, status, created_by) VALUES (?, ?, ?, 'recovery', ?, 'pending', ?)`)
        .run(t.id, key, amt, input.reason.trim().slice(0, 2000), input.actorId);
      steps.push({ reversalId: Number(r.lastInsertRowid), transferRowId: t.id, providerTransferId: t.providerId, amountMinor: amt, key });
      owed -= amt;
    }
    if (!steps.length) throw new ConnectError("There are no transfers left to reverse — recover from future settlements instead", 409);
    return { steps, unrecovered: owed };
  });

  let recovered = 0;
  const results: { reversalId: number; amountMinor: number; status: string; error?: string }[] = [];
  for (const st of plan.steps) {
    try {
      const r = await provider.reverseTransfer({ transferId: st.providerTransferId, amountMinor: st.amountMinor, idempotencyKey: st.key, metadata: { reason: "recovery", party_type: party.partyType, party_id: party.partyId } });
      await db.transaction(async (tx) => {
        const g = await postGroup(tx, {
          idempotencyKey: `reversal:${st.reversalId}`,
          sourceType: "transfer_reversal",
          sourceId: String(st.reversalId),
          description: `Transfer reversal recovering ${party.partyType} ${party.partyId} balance`,
          basis: "actual",
          currency: "EUR",
          lines: [
            { account: "stripe_clearing", amountMinor: st.amountMinor, memo: `reversal ${r.id}` },
            { account: "partner_available", amountMinor: -st.amountMinor, partyType: party.partyType, partyId: party.partyId, memo: "recovered by transfer reversal" },
          ],
          createdBy: input.actorId,
        });
        await tx.prepare(`UPDATE transfer_reversals SET status = 'created', provider_reversal_id = ?, ledger_group_id = ? WHERE id = ?`).run(r.id, g.groupId, st.reversalId);
        await tx
          .prepare(`UPDATE transfers SET reversed_minor = reversed_minor + ?, status = IF(reversed_minor >= amount_minor, 'reversed', 'partially_reversed') WHERE id = ?`)
          .run(st.amountMinor, st.transferRowId);
      });
      recovered += st.amountMinor;
      results.push({ reversalId: st.reversalId, amountMinor: st.amountMinor, status: "created" });
    } catch (e) {
      const status = isDefinitive(e) ? "failed" : "unknown";
      const message = e instanceof Error ? e.message : String(e);
      await db.prepare(`UPDATE transfer_reversals SET status = ?, note = CONCAT(COALESCE(note, ''), ?) WHERE id = ?`).run(status, ` — ${message}`.slice(0, 1000), st.reversalId);
      results.push({ reversalId: st.reversalId, amountMinor: st.amountMinor, status, error: message });
    }
  }
  await writeAudit({ actorUserId: input.actorId, action: "connect.recovered_by_reversal", objectType: `connect_${party.partyType}`, objectId: party.partyId, newValue: { recovered, unrecovered: plan.unrecovered }, reason: input.reason.trim() });
  return { recoveredMinor: recovered, unrecoveredMinor: plan.unrecovered, reversals: results };
}

// --- webhook events from connected accounts ---------------------------------------------

export async function processConnectEvent(event: IncomingEvent): Promise<"processed" | "ignored"> {
  const o = event.data.object;
  switch (event.type) {
    case "account.updated":
      return (await applyStatus(accountStatusFrom(o as never))) ? "processed" : "ignored";
    case "payout.created":
    case "payout.updated":
    case "payout.paid":
    case "payout.failed":
    case "payout.canceled": {
      if (!event.account) return "ignored";
      const known = await db.prepare(`SELECT 1 FROM connected_accounts WHERE account_id = ?`).get(event.account);
      if (!known) return "ignored";
      await db
        .prepare(
          `INSERT INTO connected_payouts (provider_payout_id, account_id, amount_minor, currency, status, arrival_date, failure_code, failure_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE amount_minor = VALUES(amount_minor), status = VALUES(status), arrival_date = VALUES(arrival_date), failure_code = VALUES(failure_code), failure_message = VALUES(failure_message)`
        )
        .run(o.id, event.account, Number(o.amount ?? 0), String(o.currency ?? "eur").toUpperCase(), String(o.status ?? "pending"), o.arrival_date ? new Date(o.arrival_date * 1000) : null, o.failure_code ?? null, o.failure_message ?? null);
      return "processed";
    }
    case "transfer.reversed": {
      // Reversals we made are already recorded; one made in the Stripe Dashboard needs a person.
      const ids: string[] = (o.reversals?.data ?? []).map((r: { id: string }) => r.id);
      if (!ids.length) return "ignored";
      const ours = (await db.prepare(`SELECT COUNT(*) as n FROM transfer_reversals WHERE provider_reversal_id IN (${ids.map(() => "?").join(",")})`).get(...ids)) as { n: number };
      if (Number(ours.n) === ids.length) return "ignored";
      throw new NeedsReviewError(`Transfer ${o.id} was reversed outside HelloCircle — reconcile the ledger by hand`);
    }
    default:
      return "ignored";
  }
}

export const CONNECT_EVENT_TYPES = new Set(["account.updated", "payout.created", "payout.updated", "payout.paid", "payout.failed", "payout.canceled", "transfer.reversed"]);

// --- partner view ---------------------------------------------------------------------

export async function payoutsOverview(party: Party) {
  const account = await getConnectedAccount(party);
  const [readiness, transfers, payouts] = await Promise.all([
    payoutReadiness(party),
    db
      .prepare(`SELECT id, settlement_id as settlementId, amount_minor as amountMinor, reversed_minor as reversedMinor, status, created_at as createdAt FROM transfers WHERE party_type = ? AND party_id = ? AND status IN ('created','partially_reversed','reversed') ORDER BY id DESC LIMIT 20`)
      .all(party.partyType, party.partyId),
    account
      ? db.prepare(`SELECT provider_payout_id as id, amount_minor as amountMinor, currency, status, arrival_date as arrivalDate, failure_message as failureMessage FROM connected_payouts WHERE account_id = ? ORDER BY created_at DESC LIMIT 20`).all(account.accountId)
      : Promise.resolve([]),
  ]);
  return {
    enabled: await connectEnabled(),
    account: account
      ? {
          detailsSubmitted: !!account.detailsSubmitted,
          payoutsEnabled: !!account.payoutsEnabled,
          transfersActive: account.transfersCapability === "active",
          requirementsDue: account.requirementsDue ? (JSON.parse(account.requirementsDue) as string[]) : [],
          disabledReason: account.disabledReason,
        }
      : null,
    readiness,
    transfers,
    payouts,
  };
}
