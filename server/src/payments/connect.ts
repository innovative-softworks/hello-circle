import crypto from "node:crypto";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { postGroup } from "../commerce/ledger.js";
import { NeedsReviewError, ledgerEnabled } from "../commerce/payments.js";
import { resolveRule } from "../commerce/rules.js";
import { DebtError, createDebt, getDebt, openDebtFor, outstandingMinor, recordRecovered, type DebtRow } from "../commerce/debts.js";
import { commerceSwitch } from "../commerce/switches.js";
import { CLIENT_URL } from "../stripe.js";
import { paymentProvider, type ConnectApiModel, type ConnectedAccountStatus, type PaymentProvider } from "./provider.js";
import type { IncomingEvent } from "./webhookEvents.js";

// Revenue & Connect Stage 5a — Stripe Connect money movement.
//
// Separate charges and transfers: customers pay HelloCircle's platform
// account; after an order completes and its review period passes it is
// released (Stage 2d), weekly settlement makes it "due", and only then does
// a finance admin's transfer run move the settled net to the partner's
// Express account.
//
// Terminology (Stage 5c), kept apart everywhere — data, API and UI:
//   transfer    HelloCircle → the partner's Stripe account (we make these:
//               table `transfers`, one per settlement, split into immutable
//               per-booking `transfer_allocations`)
//   bank payout the partner's Stripe account → their bank (Stripe makes
//               these on its own schedule; we only mirror payout.* events
//               into `connected_payouts`)
//
// A negative partner balance (a refund after transfer, or a lost dispute the
// partner is responsible for) becomes a partner debt (commerce/debts.ts):
// opened by an admin with a reason, it freezes that partner's earnings and
// is recovered by reversing *their own* transfer allocations, newest first —
// never automatically and never from anyone else's money.
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
  requirements_due as requirementsDue, disabled_reason as disabledReason, updated_at as updatedAt,
  api_model as apiModel, configuration_type as configurationType, dashboard_type as dashboardType, business_type as businessType,
  onboarding_state as onboardingState, charges_capability as chargesCapability, payouts_capability as payoutsCapability,
  requirements_past_due as requirementsPastDue, requirements_pending as requirementsPending, onboarding_completed_at as onboardingCompletedAt,
  last_synced_at as lastSyncedAt, last_event_id as lastEventId, creation_key as creationKey`;

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
  apiModel: ConnectApiModel;
  configurationType: string | null;
  dashboardType: string | null;
  businessType: string | null;
  onboardingState: OnboardingState;
  chargesCapability: string | null;
  payoutsCapability: string | null;
  requirementsPastDue: string | null;
  requirementsPending: string | null;
  onboardingCompletedAt: string | null;
  lastSyncedAt: string | null;
  lastEventId: string | null;
  creationKey: string | null;
}

/** Stage 5e — the partner-facing account states (the UI names each one; the
 * wording lives in editable help content, keys connect_state_<state>). */
export type OnboardingState =
  | "not_started"
  | "onboarding_incomplete"
  | "under_review"
  | "more_information_required"
  | "transfers_unavailable"
  | "payouts_unavailable"
  | "enabled";

const REVIEW_CODES = new Set(["requirements_pending_verification", "determining_status"]);

/** Pure: the partner-facing state from the provider's state. "Completed
 * before" separates first onboarding from Stripe asking for more later. */
export function deriveOnboardingState(st: Pick<ConnectedAccountStatus, "transfersCapability" | "payoutsCapability" | "requirementsDue" | "requirementsPastDue" | "requirementsPending" | "disabledReason">, completedBefore: boolean): OnboardingState {
  const userAction = st.requirementsDue.length + st.requirementsPastDue.length > 0;
  if (st.transfersCapability === "active" && st.payoutsCapability === "active" && !userAction) return "enabled";
  if (userAction) return completedBefore ? "more_information_required" : "onboarding_incomplete";
  if (st.requirementsPending.length > 0 || (st.disabledReason && REVIEW_CODES.has(st.disabledReason)) || st.transfersCapability === "pending") return "under_review";
  if (st.transfersCapability !== "active") return "transfers_unavailable";
  return "payouts_unavailable";
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

export async function getConnectedAccountById(accountId: string): Promise<ConnectedAccountRow | undefined> {
  return (await db.prepare(`SELECT ${ACCOUNT_FIELDS} FROM connected_accounts WHERE account_id = ?`).get(accountId)) as ConnectedAccountRow | undefined;
}

const list = (xs: string[]) => JSON.stringify(xs).slice(0, 4000);

/**
 * Stage 5e — the only way connected-account state changes locally: fetch the
 * account from the provider *now* and store it, unless a newer fetch already
 * landed (last_synced_at is the fetch start time, so a slow, older fetch can
 * never overwrite a newer one). Webhook payloads are never trusted for state —
 * an event only triggers this fetch — so an old event arriving late cannot
 * downgrade anything. Every attempt is logged in connected_account_syncs.
 */
export async function syncConnectedAccount(
  accountId: string,
  ctx: { source: "create" | "api" | "return" | "refresh" | "webhook"; normalizedType?: string; eventId?: string | null; eventType?: string | null; eventCreated?: Date | null; provider?: PaymentProvider }
): Promise<{ applied: boolean; state: OnboardingState | null }> {
  const provider = ctx.provider ?? paymentProvider();
  const row = await getConnectedAccountById(accountId);
  if (!row || !provider) return { applied: false, state: null };
  const fetchedAt = new Date();
  const st = await provider.retrieveConnectedAccount(accountId, row.apiModel ?? "v1");
  const completedBefore = !!row.onboardingCompletedAt;
  const state = deriveOnboardingState(st, completedBefore);
  // Onboarding counts as completed the first time Stripe needs nothing more from the partner.
  const completedNow = !completedBefore && st.requirementsDue.length + st.requirementsPastDue.length === 0;
  const r = await db
    .prepare(
      `UPDATE connected_accounts SET details_submitted = ?, charges_enabled = ?, payouts_enabled = ?, transfers_capability = ?, requirements_due = ?, disabled_reason = ?,
         configuration_type = ?, dashboard_type = ?, business_type = COALESCE(?, business_type), onboarding_state = ?, charges_capability = ?, payouts_capability = ?,
         requirements_past_due = ?, requirements_pending = ?, onboarding_completed_at = IF(? = 1 AND onboarding_completed_at IS NULL, ?, onboarding_completed_at),
         last_synced_at = ?, last_event_id = COALESCE(?, last_event_id), last_event_created_at = GREATEST(COALESCE(last_event_created_at, '1970-01-01'), COALESCE(?, '1970-01-01'))
       WHERE account_id = ? AND (last_synced_at IS NULL OR last_synced_at <= ?)`
    )
    .run(
      st.detailsSubmitted ? 1 : 0, st.chargesEnabled ? 1 : 0, st.payoutsEnabled ? 1 : 0, st.transfersCapability.slice(0, 20), list(st.requirementsDue), st.disabledReason?.slice(0, 120) ?? null,
      st.configurationType, st.dashboardType, st.businessType, state, st.chargesCapability.slice(0, 20), st.payoutsCapability.slice(0, 20),
      list(st.requirementsPastDue), list(st.requirementsPending), completedNow ? 1 : 0, fetchedAt,
      fetchedAt, ctx.eventId ?? null, ctx.eventCreated ?? null, accountId, fetchedAt
    );
  const applied = r.changes > 0;
  await db
    .prepare(
      `INSERT INTO connected_account_syncs (account_id, source, normalized_type, provider_event_id, provider_event_type, provider_event_created_at, before_state, after_state, applied, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(accountId, ctx.source, ctx.normalizedType ?? "connect.account.refreshed", ctx.eventId ?? null, ctx.eventType ?? null, ctx.eventCreated ?? null, row.onboardingState, state, applied ? 1 : 0, applied ? null : "a newer sync already applied");
  return { applied, state: applied ? state : row.onboardingState };
}

/** The display name Stripe shows the partner on its hosted pages. */
async function partyDisplayName(party: Party): Promise<string> {
  if (party.partyType === "org") {
    const o = (await db.prepare(`SELECT name FROM organisations WHERE id = ?`).get(party.partyId).catch(() => undefined)) as { name: string } | undefined;
    if (o?.name) return o.name;
  }
  if (party.partyType === "host") {
    const r = (await db.prepare(`SELECT name FROM residents WHERE id = ?`).get(party.partyId).catch(() => undefined)) as { name: string } | undefined;
    if (r?.name) return r.name;
  }
  return "HelloCircle partner";
}

/**
 * Stage 5e — creates the party's Accounts v2 account exactly once. A
 * reservation row (primary key = the party) is claimed first, so concurrent
 * requests for the same partner serialise on it; the provider call carries the
 * reservation's idempotency key, so a retry after a timeout — even one where
 * Stripe accepted the first request — returns the same account. A reservation
 * left "pending" (outcome never seen) is retried with the same key.
 */
async function ensureAccount(provider: PaymentProvider, party: Party, input: { email: string; country: string; actorId: string }): Promise<ConnectedAccountRow> {
  const existing = await getConnectedAccount(party);
  if (existing) return existing;
  // Fixed when the reservation is first written and reused on every retry; the
  // random part means a reservation recreated later never collides with an
  // older key still inside Stripe's idempotency window.
  const key = `hc-acct-v2:${party.partyType}:${party.partyId}:${crypto.randomUUID().slice(0, 8)}`;
  await db
    .prepare(`INSERT IGNORE INTO connected_account_creations (party_type, party_id, idempotency_key, api_model, status) VALUES (?, ?, ?, 'v2', 'pending')`)
    .run(party.partyType, party.partyId, key);
  // Serialise concurrent creators for this party on the reservation row.
  const created = await db.transaction(async (tx) => {
    const res = (await tx.prepare(`SELECT status, account_id as accountId, idempotency_key as k FROM connected_account_creations WHERE party_type = ? AND party_id = ? FOR UPDATE`).get(party.partyType, party.partyId)) as
      | { status: string; accountId: string | null; k: string }
      | undefined;
    if (!res) throw new ConnectError("Couldn't reserve the payout account", 500);
    if (res.status === "created" && res.accountId) {
      // The local account row is missing (removed by hand) but Stripe already has
      // the account: re-link it rather than creating a second one.
      const relinked = await tx
        .prepare(`INSERT IGNORE INTO connected_accounts (party_type, party_id, provider, account_id, country, api_model, creation_key, onboarding_state) VALUES (?, ?, ?, ?, ?, 'v2', ?, 'onboarding_incomplete')`)
        .run(party.partyType, party.partyId, provider.name, res.accountId, input.country, res.k);
      return { id: res.accountId, fresh: relinked.changes > 0, error: null };
    }
    const trader = (await tx.prepare(`SELECT entity_type as t FROM trader_profiles WHERE party_type = ? AND party_id = ?`).get(party.partyType, party.partyId)) as { t: string } | undefined;
    const businessType = trader?.t === "company" || trader?.t === "individual" ? (trader.t as "company" | "individual") : party.partyType === "host" ? "individual" : undefined;
    let account: { id: string; apiModel: ConnectApiModel };
    try {
      account = await provider.createConnectedAccount({
        country: input.country,
        email: input.email,
        displayName: await partyDisplayName(party),
        businessType,
        idempotencyKey: res.k,
        metadata: { party_type: party.partyType, party_id: party.partyId, hc_creation_key: res.k },
      });
    } catch (e) {
      // Recorded after this transaction releases the reservation lock (below).
      return { id: null, fresh: false, error: e as { type?: string; code?: string; message?: string } };
    }
    await tx.prepare(`UPDATE connected_account_creations SET status = 'created', account_id = ?, attempts = attempts + 1, last_error = NULL WHERE party_type = ? AND party_id = ?`).run(account.id, party.partyType, party.partyId);
    await tx
      .prepare(`INSERT IGNORE INTO connected_accounts (party_type, party_id, provider, account_id, country, api_model, business_type, creation_key, onboarding_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'onboarding_incomplete')`)
      .run(party.partyType, party.partyId, provider.name, account.id, input.country, account.apiModel, businessType ?? null, res.k);
    return { id: account.id, fresh: true, error: null };
  });
  if (created.error || !created.id) {
    const err = created.error ?? {};
    await db.prepare(`UPDATE connected_account_creations SET attempts = attempts + 1, last_error = ? WHERE party_type = ? AND party_id = ?`).run(String(err.code ?? err.type ?? err.message ?? "error").slice(0, 500), party.partyType, party.partyId);
    // Stage 5d — a provider refusal is a clear 502 with Stripe's code, not a bare 500.
    // The reservation stays pending, so a retry reuses the same idempotency key.
    throw new ConnectError(`Stripe couldn't create the payout account (${err.code ?? err.type ?? "provider error"}). Please try again.`, 502);
  }
  if (created.fresh) {
    await syncConnectedAccount(created.id, { source: "create", normalizedType: "connect.account.created", provider });
    await writeAudit({ actorUserId: input.actorId, action: "connect.account_created", objectType: `connect_${party.partyType}`, objectId: party.partyId, newValue: { accountId: created.id, apiModel: "v2" } });
  }
  const row = await getConnectedAccount(party);
  if (!row) throw new ConnectError("Payout account was created but couldn't be recorded — please try again", 500);
  return row;
}

/** Creates the party's account on first use, then returns a Stripe-hosted
 * link back to `returnPath`: onboarding the first time, an update link when
 * Stripe asks an already-onboarded partner for more information. Links are
 * single use and expire; the refresh URL mints a new one. */
export async function startOnboarding(party: Party, input: { email: string; country: string; returnPath: string; actorId: string }) {
  const provider = await requireConnect();
  if (!/^\/[\w\-/?=&]*$/.test(input.returnPath)) throw new ConnectError("Invalid return path");
  const availability = await resolveRule("availability");
  const allowed = String(availability.values.partnerCountry ?? "IE");
  if (input.country !== allowed) throw new ConnectError(`Payouts are only available to partners in ${allowed} at the moment`, 409);
  const account = await ensureAccount(provider, party, input);
  const sep = input.returnPath.includes("?") ? "&" : "?";
  const purpose = account.onboardingCompletedAt ? "update" : "onboarding";
  const link = await provider.createOnboardingLink({
    accountId: account.accountId,
    apiModel: account.apiModel,
    purpose,
    refreshUrl: `${CLIENT_URL}${input.returnPath}${sep}payouts=refresh`,
    returnUrl: `${CLIENT_URL}${input.returnPath}${sep}payouts=return`,
  });
  return { url: link.url, expiresAt: link.expiresAt, purpose };
}

export async function refreshAccount(party: Party, source: "api" | "return" = "api") {
  const provider = await requireConnect();
  const account = await getConnectedAccount(party);
  if (!account) throw new ConnectError("No payout account yet", 404);
  await syncConnectedAccount(account.accountId, { source, normalizedType: source === "return" ? "connect.onboarding.returned" : "connect.account.refreshed", provider });
  return getConnectedAccount(party);
}

export async function dashboardLink(party: Party) {
  const provider = await requireConnect();
  const account = await getConnectedAccount(party);
  if (!account) throw new ConnectError("No payout account yet", 404);
  if (!account.onboardingCompletedAt && !account.detailsSubmitted) throw new ConnectError("Finish setting up payouts first", 409);
  return provider.createDashboardLink(account.accountId);
}

/** Why a party can't receive a *transfer* yet (empty = ready). Bank payouts
 * being unavailable does not block a transfer — the money waits in the
 * partner's Stripe balance — so it's reported separately (payoutNotes). */
export async function payoutReadiness(party: Party): Promise<string[]> {
  const reasons: string[] = [];
  const account = await getConnectedAccount(party);
  if (!account) reasons.push("No payout account connected");
  else if (account.transfersCapability !== "active") reasons.push("Payout account can't receive transfers yet (verification incomplete)");
  // Stage 5c — an open partner debt freezes transfers to that partner.
  const debt = await openDebtFor(party);
  if (debt) reasons.push(`Earnings frozen: open partner debt #${debt.id}`);
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
    // Stage 5e — the random part keeps the key unique across database resets/restores and
    // across environments sharing a Stripe account (row ids repeat; Stripe keeps keys 24 h).
    // Stored on the row and reused for every retry of this attempt.
    const key = `settlement:${s.id}:${attempt}:${crypto.randomUUID().slice(0, 8)}`;
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
      await writeAllocations(tx, claim.rowId, s);
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

/** Stage 5c — splits a transfer into immutable per-booking allocation rows,
 * one per settlement item. A released booking is kind "booking" (its
 * source_type/ref name the booking); a refund adjustment names the booking it
 * refunded; anything else (a recovery, a reversal) is "adjustment". The rows
 * always sum to the transfer amount. */
async function writeAllocations(tx: Pick<typeof db, "prepare">, transferRowId: number, s: DueSettlement) {
  const items = (await tx
    .prepare(
      `SELECT i.id, i.ledger_group_id as groupId, i.amount_minor as amount, g.idempotency_key as k, g.source_type as st, g.source_id as sid
       FROM settlement_items i JOIN ledger_entry_groups g ON g.id = i.ledger_group_id WHERE i.settlement_id = ? ORDER BY i.id`
    )
    .all(s.id)) as { id: number; groupId: string; amount: number | string; k: string; st: string; sid: string }[];
  let total = 0;
  for (const it of items) {
    let kind = "adjustment";
    let sourceType: string | null = null;
    let sourceRef: string | null = null;
    if (it.k.startsWith("release:")) {
      const [, type, ref] = it.k.split(":");
      kind = "booking";
      sourceType = type;
      sourceRef = ref;
    } else if (it.st === "refund") {
      const r = (await tx.prepare(`SELECT source_type as t, source_ref as ref FROM refunds WHERE id = ?`).get(Number(it.sid))) as { t: string; ref: string } | undefined;
      kind = "refund";
      sourceType = r?.t ?? null;
      sourceRef = r?.ref ?? null;
    }
    await tx
      .prepare(`INSERT INTO transfer_allocations (transfer_id, settlement_item_id, ledger_group_id, kind, source_type, source_ref, party_type, party_id, amount_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(transferRowId, it.id, it.groupId, kind, sourceType, sourceRef, s.partyType, s.partyId, Number(it.amount));
    total += Number(it.amount);
  }
  if (total !== s.netMinor) throw new Error(`Transfer allocations for settlement ${s.id} sum to ${total}, not ${s.netMinor}`);
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

// --- partner debts: recovery by reversing the partner's own transfer allocations -------

interface AllocationRoom {
  allocationId: number;
  transferRowId: number;
  providerTransferId: string;
  room: number;
}

/** Positive allocations of this party's own transfers that can still be
 * reversed, newest first — Stage 5e: the booking that caused the debt (a
 * refund or dispute after transfer) first, when given. Only ever this party's. */
async function reversibleAllocations(tx: Pick<typeof db, "prepare">, party: { partyType: string; partyId: string }, onlyAllocationId?: number, prefer?: { sourceType: string; sourceRef: string }): Promise<AllocationRoom[]> {
  const rows = (await tx
    .prepare(
      `SELECT a.id, a.transfer_id as transferRowId, t.provider_transfer_id as providerTransferId, a.amount_minor as amount, t.amount_minor as transferAmount, t.reversed_minor as transferReversed,
         (SELECT COALESCE(SUM(r2.amount_minor), 0) FROM transfer_reversals r2 WHERE r2.transfer_id = t.id AND r2.status IN ('pending','unknown')) as transferPending,
         (SELECT COALESCE(SUM(ar.amount_minor), 0) FROM transfer_allocation_reversals ar JOIN transfer_reversals r ON r.id = ar.reversal_id WHERE ar.allocation_id = a.id AND r.status IN ('pending','unknown','created')) as allocReversed
       FROM transfer_allocations a JOIN transfers t ON t.id = a.transfer_id
       WHERE a.party_type = ? AND a.party_id = ? AND t.party_type = a.party_type AND t.party_id = a.party_id
         AND t.status IN ('created','partially_reversed') AND a.amount_minor > 0 ${onlyAllocationId ? "AND a.id = ?" : ""}
       ORDER BY (a.source_type = ? AND a.source_ref = ?) DESC, a.transfer_id DESC, a.id DESC FOR UPDATE`
    )
    .all(party.partyType, party.partyId, ...(onlyAllocationId ? [onlyAllocationId] : []), prefer?.sourceType ?? "", prefer?.sourceRef ?? "")) as {
    id: number;
    transferRowId: number;
    providerTransferId: string;
    amount: number | string;
    transferAmount: number | string;
    transferReversed: number | string;
    transferPending: number | string;
    allocReversed: number | string;
  }[];
  const transferRoom = new Map<number, number>();
  const out: AllocationRoom[] = [];
  for (const r of rows) {
    if (!transferRoom.has(r.transferRowId)) transferRoom.set(r.transferRowId, Number(r.transferAmount) - Number(r.transferReversed) - Number(r.transferPending));
    const room = Math.min(Number(r.amount) - Number(r.allocReversed), transferRoom.get(r.transferRowId)!);
    if (room <= 0) continue;
    transferRoom.set(r.transferRowId, transferRoom.get(r.transferRowId)! - room);
    out.push({ allocationId: r.id, transferRowId: r.transferRowId, providerTransferId: r.providerTransferId, room });
  }
  return out;
}

/** Plans and executes reversals for a debt, up to `limitMinor` (the debt's outstanding amount by default). */
async function reverseForDebt(provider: PaymentProvider, debt: DebtRow, input: { actorId: string; reason: string; limitMinor?: number; allocationId?: number; prefer?: { sourceType: string; sourceRef: string } }) {
  const party = { partyType: debt.partyType, partyId: debt.partyId };
  // Plan under the debt's party lock, counting reversals already in flight for this debt.
  const steps = await db.transaction(async (tx) => {
    await tx.prepare(`SELECT id FROM partner_debts WHERE id = ? FOR UPDATE`).get(debt.id);
    const fresh = (await getDebt(debt.id, tx))!;
    if (fresh.status !== "open") throw new ConnectError("This debt is already closed", 409);
    const inFlight = (await tx.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM transfer_reversals WHERE debt_id = ? AND status IN ('pending','unknown')`).get(debt.id)) as { s: number | string };
    let want = outstandingMinor(fresh) - Number(inFlight.s);
    if (input.limitMinor !== undefined) want = Math.min(want, Math.floor(input.limitMinor));
    if (want <= 0) throw new ConnectError("Nothing left to recover on this debt", 409);
    const allocations = await reversibleAllocations(tx, party, input.allocationId, input.prefer);
    if (input.allocationId && !allocations.length) throw new ConnectError("That allocation can't be reversed (not this partner's, not positive, or already fully reversed)", 409);
    // Group the allocation slices by transfer: one provider reversal per transfer.
    const byTransfer = new Map<number, { providerTransferId: string; parts: { allocationId: number; amount: number }[] }>();
    for (const a of allocations) {
      if (want <= 0) break;
      const take = Math.min(a.room, want);
      const entry = byTransfer.get(a.transferRowId) ?? { providerTransferId: a.providerTransferId, parts: [] };
      entry.parts.push({ allocationId: a.allocationId, amount: take });
      byTransfer.set(a.transferRowId, entry);
      want -= take;
    }
    const planned: { reversalId: number; transferRowId: number; providerTransferId: string; amountMinor: number; key: string; parts: { allocationId: number; amount: number }[] }[] = [];
    for (const [transferRowId, e] of byTransfer) {
      const amount = e.parts.reduce((x, p) => x + p.amount, 0);
      const n = ((await tx.prepare(`SELECT COUNT(*) as n FROM transfer_reversals WHERE transfer_id = ?`).get(transferRowId)) as { n: number }).n;
      const key = `reversal:${transferRowId}:${Number(n) + 1}:${crypto.randomUUID().slice(0, 8)}`; // unique across resets/environments (Stage 5e)
      const r = await tx
        .prepare(`INSERT INTO transfer_reversals (transfer_id, idempotency_key, amount_minor, reason, note, status, created_by, debt_id) VALUES (?, ?, ?, 'recovery', ?, 'pending', ?, ?)`)
        .run(transferRowId, key, amount, input.reason.trim().slice(0, 2000), input.actorId, debt.id);
      const reversalId = Number(r.lastInsertRowid);
      for (const part of e.parts) {
        await tx.prepare(`INSERT INTO transfer_allocation_reversals (allocation_id, reversal_id, amount_minor) VALUES (?, ?, ?)`).run(part.allocationId, reversalId, part.amount);
      }
      planned.push({ reversalId, transferRowId, providerTransferId: e.providerTransferId, amountMinor: amount, key, parts: e.parts });
    }
    return planned;
  });

  let recovered = 0;
  const results: { reversalId: number; amountMinor: number; status: string; allocations: { allocationId: number; amount: number }[]; error?: string }[] = [];
  for (const st of steps) {
    try {
      const r = await provider.reverseTransfer({ transferId: st.providerTransferId, amountMinor: st.amountMinor, idempotencyKey: st.key, metadata: { reason: "recovery", debt_id: String(debt.id), party_type: party.partyType, party_id: party.partyId } });
      await db.transaction(async (tx) => {
        const g = await postGroup(tx, {
          idempotencyKey: `reversal:${st.reversalId}`,
          sourceType: "transfer_reversal",
          sourceId: String(st.reversalId),
          description: `Transfer reversal recovering debt #${debt.id} (${party.partyType} ${party.partyId})`,
          basis: "actual",
          currency: "EUR",
          lines: [
            { account: "stripe_clearing", amountMinor: st.amountMinor, memo: `reversal ${r.id}` },
            { account: "partner_available", amountMinor: -st.amountMinor, partyType: party.partyType, partyId: party.partyId, memo: `recovered for debt #${debt.id}` },
          ],
          createdBy: input.actorId,
        });
        await tx.prepare(`UPDATE transfer_reversals SET status = 'created', provider_reversal_id = ?, ledger_group_id = ? WHERE id = ?`).run(r.id, g.groupId, st.reversalId);
        await tx
          .prepare(`UPDATE transfers SET reversed_minor = reversed_minor + ?, status = IF(reversed_minor >= amount_minor, 'reversed', 'partially_reversed') WHERE id = ?`)
          .run(st.amountMinor, st.transferRowId);
        await recordRecovered(tx, debt.id, st.amountMinor);
      });
      recovered += st.amountMinor;
      results.push({ reversalId: st.reversalId, amountMinor: st.amountMinor, status: "created", allocations: st.parts });
    } catch (e) {
      // A refusal frees the planned allocations again; an unseen outcome keeps them reserved (retried with the same key).
      const status = isDefinitive(e) ? "failed" : "unknown";
      const message = e instanceof Error ? e.message : String(e);
      await db.prepare(`UPDATE transfer_reversals SET status = ?, note = CONCAT(COALESCE(note, ''), ?) WHERE id = ?`).run(status, ` — ${message}`.slice(0, 1000), st.reversalId);
      results.push({ reversalId: st.reversalId, amountMinor: st.amountMinor, status, allocations: st.parts, error: message });
    }
  }
  const after = (await getDebt(debt.id))!;
  return { debtId: debt.id, recoveredMinor: recovered, unrecoveredMinor: outstandingMinor(after), status: after.status, reversals: results };
}

function debtError(e: unknown): never {
  if (e instanceof DebtError) throw new ConnectError(e.message, e.status);
  throw e;
}

/** Opens a partner debt (freezing their earnings) and immediately tries to
 * recover it by reversing their own transfers. What can't be recovered stays
 * open and is offset against their future earnings. */
export async function openPartnerDebt(party: Party, input: { actorId: string; reason: string; prefer?: { sourceType: string; sourceRef: string } }) {
  const provider = await requireConnect();
  if (!(await ledgerEnabled())) throw new ConnectError("Turn on the financial ledger switch first", 409);
  const debt = await createDebt(party, input).catch(debtError);
  const hasTransfers = await db.prepare(`SELECT 1 FROM transfers WHERE party_type = ? AND party_id = ? AND status IN ('created','partially_reversed') LIMIT 1`).get(party.partyType, party.partyId);
  const result = hasTransfers ? await reverseForDebt(provider, debt, input) : { debtId: debt.id, recoveredMinor: 0, unrecoveredMinor: outstandingMinor(debt), status: debt.status, reversals: [] };
  await writeAudit({ actorUserId: input.actorId, action: "partner_debt.recovery_attempted", objectType: `partner_${party.partyType}`, objectId: party.partyId, newValue: { debtId: debt.id, recovered: result.recoveredMinor, unrecovered: result.unrecoveredMinor }, reason: input.reason.trim() });
  return result;
}

/** Tries again to recover an open debt (e.g. after a failed reversal). */
export async function retryDebtRecovery(debtId: number, input: { actorId: string; reason: string }) {
  if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new ConnectError("A reason (at least 5 characters) is required");
  const provider = await requireConnect();
  const debt = await getDebt(debtId);
  if (!debt) throw new ConnectError("Debt not found", 404);
  if (debt.status !== "open") throw new ConnectError("This debt is already closed", 409);
  const result = await reverseForDebt(provider, debt, input);
  await writeAudit({ actorUserId: input.actorId, action: "partner_debt.recovery_attempted", objectType: `partner_${debt.partyType}`, objectId: debt.partyId, newValue: { debtId, recovered: result.recoveredMinor, unrecovered: result.unrecoveredMinor }, reason: input.reason.trim() });
  return result;
}

/** Partial reversal of one booking's allocation, towards that partner's open debt. */
export async function reverseAllocation(allocationId: number, input: { actorId: string; reason: string; amountMinor: number }) {
  if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new ConnectError("A reason (at least 5 characters) is required");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new ConnectError("Amount must be a positive number of cents");
  const provider = await requireConnect();
  const a = (await db.prepare(`SELECT party_type as partyType, party_id as partyId FROM transfer_allocations WHERE id = ?`).get(allocationId)) as { partyType: string; partyId: string } | undefined;
  if (!a) throw new ConnectError("Allocation not found", 404);
  const debt = await openDebtFor(a);
  if (!debt) throw new ConnectError("Open a partner debt first — an allocation is only reversed to recover what this partner owes", 409);
  if (input.amountMinor > outstandingMinor(debt)) throw new ConnectError("That's more than this partner owes", 409);
  const result = await reverseForDebt(provider, debt, { ...input, limitMinor: input.amountMinor, allocationId });
  await writeAudit({ actorUserId: input.actorId, action: "transfer_allocation.reversed", objectType: "transfer_allocation", objectId: String(allocationId), newValue: { debtId: debt.id, amountMinor: result.recoveredMinor }, reason: input.reason.trim() });
  return result;
}

// --- webhook events from connected accounts ---------------------------------------------

/**
 * Stage 5e — normalized internal Connect events. Provider event names (v1
 * snapshot events and v2 thin events, which name the same thing differently)
 * map onto these; nothing outside this file depends on Stripe's naming.
 */
export type NormalizedConnectEvent =
  | "connect.account.changed"
  | "connect.onboarding.returned"
  | "connect.bank_payout.changed"
  | "connect.transfer.reversed_externally"
  | "connect.ignored";

export function normalizeConnectEvent(providerType: string): NormalizedConnectEvent {
  if (providerType === "account.updated" || providerType === "capability.updated" || providerType === "account.external_account.updated") return "connect.account.changed";
  if (/^v2\.core\.account(\[[a-z_.]+\])?\.(created|updated|capability_status_updated|closed)$/.test(providerType)) return "connect.account.changed";
  if (providerType === "v2.core.account_link.returned") return "connect.onboarding.returned";
  if (/^payout\.(created|updated|paid|failed|canceled)$/.test(providerType)) return "connect.bank_payout.changed";
  if (providerType === "transfer.reversed") return "connect.transfer.reversed_externally";
  return "connect.ignored";
}

// A payout's status only moves forward; a late, older event can't move it back
// (paid → failed is a real Stripe transition and is allowed).
const PAYOUT_RANK = `CASE %s WHEN 'pending' THEN 1 WHEN 'in_transit' THEN 2 WHEN 'paid' THEN 3 WHEN 'failed' THEN 4 WHEN 'canceled' THEN 4 ELSE 0 END`;

export async function processConnectEvent(event: IncomingEvent): Promise<"processed" | "ignored"> {
  const o = event.data.object;
  const normalized = normalizeConnectEvent(event.type);
  switch (normalized) {
    case "connect.account.changed": {
      // The payload is a hint only: the account is re-fetched now.
      const accountId = event.type.startsWith("account.") ? String(o.id) : event.account ?? String(o.id ?? "");
      if (!accountId || !(await getConnectedAccountById(accountId))) return "ignored";
      await syncConnectedAccount(accountId, { source: "webhook", normalizedType: normalized, eventId: event.id, eventType: event.type, eventCreated: event.created ? new Date(event.created * 1000) : null });
      return "processed";
    }
    case "connect.bank_payout.changed": {
      if (!event.account) return "ignored";
      const known = await db.prepare(`SELECT 1 FROM connected_accounts WHERE account_id = ?`).get(event.account);
      if (!known) return "ignored";
      await db
        .prepare(
          `INSERT INTO connected_payouts (provider_payout_id, account_id, amount_minor, currency, status, arrival_date, failure_code, failure_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             amount_minor = VALUES(amount_minor), arrival_date = VALUES(arrival_date),
             failure_code = IF(${PAYOUT_RANK.replace("%s", "VALUES(status)")} >= ${PAYOUT_RANK.replace("%s", "status")}, VALUES(failure_code), failure_code),
             failure_message = IF(${PAYOUT_RANK.replace("%s", "VALUES(status)")} >= ${PAYOUT_RANK.replace("%s", "status")}, VALUES(failure_message), failure_message),
             status = IF(${PAYOUT_RANK.replace("%s", "VALUES(status)")} >= ${PAYOUT_RANK.replace("%s", "status")}, VALUES(status), status)`
        )
        .run(o.id, event.account, Number(o.amount ?? 0), String(o.currency ?? "eur").toUpperCase(), String(o.status ?? "pending"), o.arrival_date ? new Date(o.arrival_date * 1000) : null, o.failure_code ?? null, o.failure_message ?? null);
      return "processed";
    }
    case "connect.transfer.reversed_externally": {
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

/** Stage 5e — a verified v2 thin event: re-fetched from Stripe by id (never
 * trusted as delivered), then routed through the same normalized handling. */
export async function processThinConnectEvent(eventId: string): Promise<"processed" | "ignored"> {
  const provider = paymentProvider();
  if (!provider) return "ignored";
  const e = await provider.retrieveThinEvent(eventId);
  if (!e) throw new NeedsReviewError(`v2 event ${eventId} couldn't be retrieved from the provider`);
  if (e.livemode && process.env.NODE_ENV !== "production") return "ignored";
  const normalized = normalizeConnectEvent(e.type);
  if (normalized !== "connect.account.changed" && normalized !== "connect.onboarding.returned") return "ignored";
  if (!e.relatedObjectId || !(await getConnectedAccountById(e.relatedObjectId))) return "ignored";
  await syncConnectedAccount(e.relatedObjectId, { source: "webhook", normalizedType: normalized, eventId: e.id, eventType: e.type, eventCreated: new Date(e.created), provider });
  return "processed";
}

export const CONNECT_EVENT_TYPES = new Set(["account.updated", "capability.updated", "account.external_account.updated", "payout.created", "payout.updated", "payout.paid", "payout.failed", "payout.canceled", "transfer.reversed"]);

// --- partner view ---------------------------------------------------------------------

interface TransferListRow { id: number; settlementId: number; amountMinor: number | string; reversedMinor: number | string; status: string; createdAt: string; bookings: number | string }
interface BankPayoutListRow { id: string; amountMinor: number | string; currency: string; status: string; arrivalDate: string | null; failureMessage: string | null }

export type PayoutHistoryStatus = "sent" | "in_transit" | "paid" | "failed" | "reversed" | "partly_reversed";
export interface PayoutHistoryItem {
  id: string;
  type: "transfer" | "bank_payout";
  date: string | null;
  amountCents: number;
  status: PayoutHistoryStatus;
  settlementRef: string | null;
  bookings: number | null;
  recoveredCents: number | null;
  failureMessage: string | null;
}

/** Stripe payout statuses → the partner-facing vocabulary. */
export function bankPayoutStatus(stripeStatus: string): PayoutHistoryStatus {
  if (stripeStatus === "paid") return "paid";
  if (stripeStatus === "failed" || stripeStatus === "canceled") return "failed";
  return "in_transit"; // pending, in_transit
}

/** Read-only view over existing transfer and bank-payout records — never creates one. */
async function payoutHistory(transfers: TransferListRow[], payouts: BankPayoutListRow[]): Promise<PayoutHistoryItem[]> {
  const runKeys = new Map<number, string>();
  const ids = [...new Set(transfers.map((t) => Number(t.settlementId)))];
  if (ids.length) {
    const rows = (await db
      .prepare(`SELECT s.id, r.run_key as runKey FROM settlements s JOIN settlement_runs r ON r.id = s.run_id WHERE s.id IN (${ids.map(() => "?").join(", ")})`)
      .all(...ids)) as { id: number; runKey: string }[];
    for (const r of rows) runKeys.set(Number(r.id), r.runKey);
  }
  const items: PayoutHistoryItem[] = [
    ...transfers.map((t) => ({
      id: `transfer-${t.id}`,
      type: "transfer" as const,
      date: t.createdAt,
      amountCents: Number(t.amountMinor),
      status: (t.status === "reversed" ? "reversed" : t.status === "partially_reversed" ? "partly_reversed" : "sent") as PayoutHistoryStatus,
      settlementRef: runKeys.get(Number(t.settlementId)) ?? null,
      bookings: Number(t.bookings),
      recoveredCents: Number(t.reversedMinor) > 0 ? Number(t.reversedMinor) : null,
      failureMessage: null,
    })),
    ...payouts.map((p) => ({
      id: `payout-${p.id}`,
      type: "bank_payout" as const,
      date: p.arrivalDate,
      amountCents: Number(p.amountMinor),
      status: bankPayoutStatus(p.status),
      settlementRef: null,
      bookings: null,
      recoveredCents: null,
      failureMessage: p.failureMessage,
    })),
  ];
  return items.sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
}

export async function payoutsOverview(party: Party) {
  const account = await getConnectedAccount(party);
  const [readiness, transfers, payouts] = await Promise.all([
    payoutReadiness(party),
    db
      .prepare(
        `SELECT t.id, t.settlement_id as settlementId, t.amount_minor as amountMinor, t.reversed_minor as reversedMinor, t.status, t.created_at as createdAt,
           (SELECT COUNT(*) FROM transfer_allocations a WHERE a.transfer_id = t.id AND a.kind = 'booking') as bookings
         FROM transfers t WHERE t.party_type = ? AND t.party_id = ? AND t.status IN ('created','partially_reversed','reversed') ORDER BY t.id DESC LIMIT 20`
      )
      .all(party.partyType, party.partyId),
    account
      ? db.prepare(`SELECT provider_payout_id as id, amount_minor as amountMinor, currency, status, arrival_date as arrivalDate, failure_message as failureMessage FROM connected_payouts WHERE account_id = ? ORDER BY created_at DESC LIMIT 20`).all(account.accountId)
      : Promise.resolve([]),
  ]);
  return {
    enabled: await connectEnabled(),
    /** Stage 5e — one of the OnboardingState values ("not_started" when there's no account). */
    state: (account?.onboardingState ?? "not_started") as OnboardingState,
    account: account
      ? {
          apiModel: account.apiModel,
          businessType: account.businessType,
          detailsSubmitted: !!account.detailsSubmitted,
          payoutsEnabled: !!account.payoutsEnabled,
          transfersActive: account.transfersCapability === "active",
          transfersCapability: account.transfersCapability,
          payoutsCapability: account.payoutsCapability ?? (account.payoutsEnabled ? "active" : "restricted"),
          requirementsDue: account.requirementsDue ? (JSON.parse(account.requirementsDue) as string[]) : [],
          requirementsPastDue: account.requirementsPastDue ? (JSON.parse(account.requirementsPastDue) as string[]) : [],
          requirementsPending: account.requirementsPending ? (JSON.parse(account.requirementsPending) as string[]) : [],
          disabledReason: account.disabledReason,
          onboardingCompleted: !!account.onboardingCompletedAt,
          lastSyncedAt: account.lastSyncedAt,
        }
      : null,
    readiness,
    /** HelloCircle → the partner's Stripe account (settlement transfers). */
    transfers,
    /** The partner's Stripe account → their bank (made by Stripe; mirrored). */
    bankPayouts: payouts,
    // Commercial UX R3A — the same two record sets as one dated list with a
    // shared status vocabulary (additive; `transfers`/`bankPayouts` unchanged).
    history: await payoutHistory(transfers as TransferListRow[], payouts as BankPayoutListRow[]),
    /** The weekly minimum before a transfer is made, from this partner's settlement rule. */
    minimumPayoutCents: await resolveRule("settlement", { orgId: party.partyType === "org" ? party.partyId : null, hostResidentId: party.partyType === "host" ? party.partyId : null })
      .then((r) => (Number.isFinite(Number(r.values.minPayoutMinor)) ? Number(r.values.minPayoutMinor) : null))
      .catch(() => null),
    openDebt: await openDebtFor(party).then((d) => (d ? { id: d.id, outstandingMinor: outstandingMinor(d), openedAt: d.openedAt } : null)),
  };
}
