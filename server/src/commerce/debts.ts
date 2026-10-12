import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";

// Revenue & Connect Stage 5c — partner debts.
//
// A debt is what one partner owes back to HelloCircle: a refund made after
// their money was transferred, or a lost dispute they're responsible for —
// i.e. their *available* balance is negative. Opening a debt (admin, with a
// reason) freezes that partner's earnings: settlement runs carry them
// forward and no transfer is sent. Recovery then comes only from the same
// partner — reversing their own earlier transfers (payments/connect.ts), and
// offsetting against their own future earnings. When their available
// balance is back to zero or above, the debt closes as offset and the freeze
// lifts. Another partner's money is never touched: every query here is
// scoped to the debt's own party.

type Tx = Pick<typeof db, "prepare">;
export type DebtParty = { partyType: string; partyId: string };

export class DebtError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

export interface DebtRow {
  id: number;
  partyType: string;
  partyId: string;
  status: "open" | "recovered" | "offset";
  openedMinor: number;
  recoveredMinor: number;
  offsetMinor: number;
  reason: string;
  openedBy: string;
  openedAt: string;
  closedAt: string | null;
}

const FIELDS = `id, party_type as partyType, party_id as partyId, status, opened_minor as openedMinor, recovered_minor as recoveredMinor,
  offset_minor as offsetMinor, reason, opened_by as openedBy, opened_at as openedAt, closed_at as closedAt`;

const norm = (r: DebtRow | undefined): DebtRow | undefined =>
  r ? { ...r, openedMinor: Number(r.openedMinor), recoveredMinor: Number(r.recoveredMinor), offsetMinor: Number(r.offsetMinor) } : undefined;

/** The party's available balance (owed to them; negative = they owe), from the ledger. */
export async function availableMinor(tx: Tx, party: DebtParty): Promise<number> {
  const r = (await tx.prepare(`SELECT COALESCE(SUM(amount_minor), 0) as s FROM ledger_entries WHERE account_code = 'partner_available' AND party_type = ? AND party_id = ?`).get(party.partyType, party.partyId)) as { s: number | string };
  return 0 - Number(r.s) || 0;
}

export async function openDebtFor(party: DebtParty, tx: Tx = db): Promise<DebtRow | undefined> {
  return norm((await tx.prepare(`SELECT ${FIELDS} FROM partner_debts WHERE party_type = ? AND party_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`).get(party.partyType, party.partyId)) as DebtRow | undefined);
}

export async function getDebt(id: number, tx: Tx = db): Promise<DebtRow | undefined> {
  return norm((await tx.prepare(`SELECT ${FIELDS} FROM partner_debts WHERE id = ?`).get(id)) as DebtRow | undefined);
}

export const outstandingMinor = (d: DebtRow) => d.openedMinor - d.recoveredMinor - d.offsetMinor;

export async function listDebts(status?: string) {
  const rows = (await db.prepare(`SELECT ${FIELDS} FROM partner_debts ${status ? "WHERE status = ?" : ""} ORDER BY id DESC LIMIT 200`).all(...(status ? [status] : []))) as DebtRow[];
  return rows.map((r) => ({ ...norm(r)!, outstandingMinor: outstandingMinor(norm(r)!) }));
}

/** Opens (and freezes) a debt for what the party owes now. One open debt per party. */
export async function createDebt(party: DebtParty, input: { actorId: string; reason: string }): Promise<DebtRow> {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 10) throw new DebtError("A reason (at least 10 characters) is required to open a partner debt");
  const id = await db.transaction(async (tx) => {
    // Serialise per party.
    await tx.prepare(`SELECT id FROM partner_debts WHERE party_type = ? AND party_id = ? FOR UPDATE`).all(party.partyType, party.partyId);
    if (await openDebtFor(party, tx)) throw new DebtError("This partner already has an open debt — retry its recovery instead", 409);
    const owed = -(await availableMinor(tx, party));
    if (owed <= 0) throw new DebtError("This partner doesn't owe anything", 409);
    const r = await tx.prepare(`INSERT INTO partner_debts (party_type, party_id, status, opened_minor, reason, opened_by) VALUES (?, ?, 'open', ?, ?, ?)`).run(party.partyType, party.partyId, owed, reason.slice(0, 2000), input.actorId);
    return Number(r.lastInsertRowid);
  });
  await writeAudit({ actorUserId: input.actorId, action: "partner_debt.opened", objectType: `partner_${party.partyType}`, objectId: party.partyId, newValue: { debtId: id }, reason });
  return (await getDebt(id))!;
}

/** Records amounts recovered by transfer reversal; closes the debt when fully recovered. */
export async function recordRecovered(tx: Tx, debtId: number, amountMinor: number) {
  await tx.prepare(`UPDATE partner_debts SET recovered_minor = recovered_minor + ? WHERE id = ? AND status = 'open'`).run(amountMinor, debtId);
  await tx.prepare(`UPDATE partner_debts SET status = 'recovered', closed_at = NOW() WHERE id = ? AND status = 'open' AND recovered_minor + offset_minor >= opened_minor`).run(debtId);
}

/** Settlement-time check for a party: "frozen" while its open debt isn't
 * covered; when its available balance is back to ≥ 0 (its own new earnings
 * absorbed the rest) the debt closes as offset and settlement can proceed. */
export async function debtGate(party: DebtParty, netMinor: number, dryRun: boolean): Promise<{ frozen: false } | { frozen: true; debtId: number }> {
  const debt = await openDebtFor(party);
  if (!debt) return { frozen: false };
  if (netMinor < 0) return { frozen: true, debtId: debt.id };
  if (!dryRun) {
    await db
      .prepare(`UPDATE partner_debts SET offset_minor = opened_minor - recovered_minor, status = 'offset', closed_at = NOW() WHERE id = ? AND status = 'open'`)
      .run(debt.id);
    await writeAudit({ actorUserId: null, actorKind: "system", action: "partner_debt.offset", objectType: `partner_${party.partyType}`, objectId: party.partyId, newValue: { debtId: debt.id, offsetMinor: outstandingMinor(debt) } });
  }
  return { frozen: false };
}
