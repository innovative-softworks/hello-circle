// Revenue & Connect Stage 2c — append-only double-entry ledger (brief §12).
//
// Sign convention: amount_minor > 0 is a DEBIT, < 0 is a CREDIT. Every group
// sums to exactly zero. A group is identified by an idempotency key, so the
// same business event (a payment, a refund, a dispute outcome) can be posted
// any number of times — by webhook retries, replays or concurrent requests —
// and exists once. Nothing here updates or deletes a ledger row: corrections
// are new groups that reverse earlier ones, in full or in proportion.

import crypto from "node:crypto";
import { db } from "../db/index.js";
import { allocate } from "./money.js";

type Tx = Pick<typeof db, "prepare">;

export interface LedgerLine {
  account: string;
  /** > 0 debit, < 0 credit; integer minor units, never 0. */
  amountMinor: number;
  partyType?: string | null;
  partyId?: string | null;
  memo?: string;
}

export interface PostInput {
  idempotencyKey: string;
  sourceType: string;
  sourceId: string;
  description: string;
  /** "actual" money movements vs "estimate" accruals (reported separately). */
  basis: "actual" | "estimate";
  currency: string;
  lines: LedgerLine[];
  reversesGroupId?: string | null;
  createdBy?: string | null;
}

export class LedgerError extends Error {}

/** Posts a balanced group once. Returns the existing group when the key was
 * already posted (created: false) — never a second copy. Must run inside the
 * caller's transaction so the posting commits with the business change. */
export async function postGroup(tx: Tx, input: PostInput): Promise<{ groupId: string; created: boolean }> {
  const lines = input.lines.filter((l) => l.amountMinor !== 0);
  if (!lines.length) throw new LedgerError(`Ledger group ${input.idempotencyKey} has no non-zero lines`);
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amountMinor)) throw new LedgerError(`Ledger amount must be an integer (minor units), got ${l.amountMinor}`);
  }
  const sum = lines.reduce((a, l) => a + l.amountMinor, 0);
  if (sum !== 0) throw new LedgerError(`Ledger group ${input.idempotencyKey} doesn't balance (off by ${sum})`);
  // Stage 5c — no database foreign keys in this schema (house rule; the QA and
  // production DB users have no REFERENCES privilege): the account codes are
  // checked here instead, before anything is written for the group.
  const codes = [...new Set(lines.map((l) => l.account))];
  const known = (await tx.prepare(`SELECT code FROM ledger_accounts WHERE code IN (${codes.map(() => "?").join(",")})`).all(...codes)) as { code: string }[];
  const missing = codes.filter((c) => !known.some((k) => k.code === c));
  if (missing.length) throw new LedgerError(`Unknown ledger account(s): ${missing.join(", ")}`);

  const existing = (await tx.prepare(`SELECT id FROM ledger_entry_groups WHERE idempotency_key = ?`).get(input.idempotencyKey)) as { id: string } | undefined;
  if (existing) return { groupId: existing.id, created: false };
  const groupId = crypto.randomUUID();
  try {
    await tx
      .prepare(
        `INSERT INTO ledger_entry_groups (id, idempotency_key, source_type, source_id, description, basis, reverses_group_id, currency, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(groupId, input.idempotencyKey, input.sourceType, input.sourceId, input.description.slice(0, 255), input.basis, input.reversesGroupId ?? null, input.currency, input.createdBy ?? null);
  } catch (e) {
    if (e instanceof Error && /Duplicate/.test(e.message)) {
      const raced = (await tx.prepare(`SELECT id FROM ledger_entry_groups WHERE idempotency_key = ?`).get(input.idempotencyKey)) as { id: string } | undefined;
      if (raced) return { groupId: raced.id, created: false };
    }
    throw e;
  }
  let lineNo = 0;
  for (const l of lines) {
    await tx
      .prepare(`INSERT INTO ledger_entries (group_id, line_no, account_code, party_type, party_id, amount_minor, currency, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(groupId, ++lineNo, l.account, l.partyType ?? null, l.partyId ?? null, l.amountMinor, input.currency, (l.memo ?? "").slice(0, 255));
  }
  return { groupId, created: true };
}

export async function groupLines(tx: Tx, groupId: string): Promise<(LedgerLine & { lineNo: number })[]> {
  const rows = (await tx
    .prepare(`SELECT line_no as lineNo, account_code as account, party_type as partyType, party_id as partyId, amount_minor as amountMinor, memo FROM ledger_entries WHERE group_id = ? ORDER BY line_no`)
    .all(groupId)) as { lineNo: number; account: string; partyType: string | null; partyId: string | null; amountMinor: number | string; memo: string }[];
  return rows.map((r) => ({ ...r, amountMinor: Number(r.amountMinor) }));
}

/** Reverses a group in full, or in proportion `numerator/denominator` (a
 * partial refund). Proportional reversal splits the same total across the
 * debit lines and across the credit lines by their weights (largest
 * remainder), so the reversal always balances exactly. */
export async function reverseGroup(
  tx: Tx,
  groupId: string,
  opts: {
    idempotencyKey: string;
    sourceType: string;
    sourceId: string;
    description: string;
    ratio?: { numerator: number; denominator: number };
    createdBy?: string | null;
    /** Post a reversed line to a different account (e.g. a refund after
     * completion comes out of the partner's available balance). */
    accountMap?: Record<string, string>;
  }
): Promise<{ groupId: string; created: boolean }> {
  const group = (await tx.prepare(`SELECT currency, basis FROM ledger_entry_groups WHERE id = ?`).get(groupId)) as { currency: string; basis: "actual" | "estimate" } | undefined;
  if (!group) throw new LedgerError(`No ledger group ${groupId}`);
  const original = await groupLines(tx, groupId);
  let reversed: LedgerLine[];
  if (!opts.ratio || opts.ratio.numerator === opts.ratio.denominator) {
    reversed = original.map((l) => ({ ...l, amountMinor: -l.amountMinor }));
  } else {
    const { numerator, denominator } = opts.ratio;
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator <= 0 || denominator <= 0 || numerator > denominator) {
      throw new LedgerError("Reversal ratio must be 0 < numerator ≤ denominator");
    }
    const debits = original.filter((l) => l.amountMinor > 0);
    const credits = original.filter((l) => l.amountMinor < 0);
    const debitTotal = debits.reduce((a, l) => a + l.amountMinor, 0);
    const target = Math.floor((debitTotal * numerator + Math.floor(denominator / 2)) / denominator);
    if (target === 0) throw new LedgerError("Reversal amount rounds to zero");
    const dParts = allocate(target, debits.map((l) => l.amountMinor));
    const cParts = allocate(target, credits.map((l) => -l.amountMinor));
    reversed = [
      ...debits.map((l, i) => ({ ...l, amountMinor: -dParts[i] })),
      ...credits.map((l, i) => ({ ...l, amountMinor: cParts[i] })),
    ];
  }
  return postGroup(tx, {
    idempotencyKey: opts.idempotencyKey,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    description: opts.description,
    basis: group.basis,
    currency: group.currency,
    lines: reversed.map(({ account, amountMinor, partyType, partyId, memo }) => ({ account: opts.accountMap?.[account] ?? account, amountMinor, partyType, partyId, memo: memo ? `reversal: ${memo}` : "reversal" })),
    reversesGroupId: groupId,
    createdBy: opts.createdBy,
  });
}

/** Balances (debit-positive) by account, optionally for one party. */
export async function balances(filter: { partyType?: string; partyId?: string; basis?: "actual" | "estimate" } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.partyType) {
    where.push("e.party_type = ?");
    params.push(filter.partyType);
  }
  if (filter.partyId) {
    where.push("e.party_id = ?");
    params.push(filter.partyId);
  }
  if (filter.basis) {
    where.push("g.basis = ?");
    params.push(filter.basis);
  }
  const rows = (await db
    .prepare(
      `SELECT e.account_code as account, a.name, a.account_type as accountType, e.currency, SUM(e.amount_minor) as balanceMinor
       FROM ledger_entries e JOIN ledger_entry_groups g ON g.id = e.group_id JOIN ledger_accounts a ON a.code = e.account_code
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       GROUP BY e.account_code, a.name, a.account_type, e.currency ORDER BY e.account_code`
    )
    .all(...params)) as { account: string; name: string; accountType: string; currency: string; balanceMinor: number | string }[];
  return rows.map((r) => ({ ...r, balanceMinor: Number(r.balanceMinor) }));
}

/** Trial balance check: every group balances, so the whole ledger sums to 0. */
export async function ledgerIsBalanced(): Promise<boolean> {
  const { total } = (await db.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as total FROM ledger_entries`).get()) as { total: number | string };
  return Number(total) === 0;
}
