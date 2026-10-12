import { db } from "./db/index.js";

// Revenue & Connect Stage 5c — consent records, one purpose per record.
//
// Contractual acceptance of Terms/agreements is NOT here (policy_acceptances,
// policy/cms.ts) and nothing in this file is ever derived from it: accepting
// the Terms grants no marketing, no cookies, and isn't a privacy
// acknowledgement. Each purpose has its own append-only history; the newest
// row per (subject, purpose) is the current choice, and "no record" means
// not granted (marketing, analytics and advertising are opt-in).

export const PURPOSES = ["privacy_notice_ack", "marketing_email", "analytics_cookies", "advertising_cookies"] as const;
export type ConsentPurpose = (typeof PURPOSES)[number];
export type ConsentSubject = { type: "resident" | "user" | "client"; id: string };

type Tx = Pick<typeof db, "prepare">;

export async function recordConsent(
  subject: ConsentSubject,
  purpose: ConsentPurpose,
  granted: boolean,
  source: string,
  policy?: { docKey: string; version: number } | null,
  tx: Tx = db
): Promise<void> {
  if (!(PURPOSES as readonly string[]).includes(purpose)) throw new Error(`Unknown consent purpose ${purpose}`);
  await tx
    .prepare(`INSERT INTO consent_records (subject_type, subject_id, purpose, granted, policy_doc_key, policy_version, source) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(subject.type, subject.id, purpose, granted ? 1 : 0, policy?.docKey ?? null, policy?.version ?? null, source.slice(0, 30));
  // Keep the legacy column (read by older code paths and exports) in step for marketing.
  if (purpose === "marketing_email" && subject.type !== "client") {
    await tx.prepare(`UPDATE ${subject.type === "resident" ? "residents" : "users"} SET marketing_consent = ? WHERE id = ?`).run(granted ? 1 : 0, subject.id);
  }
}

export interface ConsentState {
  granted: boolean;
  source: string | null;
  policyDocKey: string | null;
  policyVersion: number | null;
  at: string | null;
}

/** Current choice per purpose (not granted when there's no record). */
export async function currentConsents(subject: ConsentSubject): Promise<Record<ConsentPurpose, ConsentState>> {
  const rows = (await db
    .prepare(
      `SELECT c.purpose, c.granted, c.source, c.policy_doc_key as docKey, c.policy_version as version, c.created_at as at FROM consent_records c
       JOIN (SELECT purpose, MAX(id) as id FROM consent_records WHERE subject_type = ? AND subject_id = ? GROUP BY purpose) m ON m.id = c.id`
    )
    .all(subject.type, subject.id)) as { purpose: ConsentPurpose; granted: number; source: string; docKey: string | null; version: number | null; at: string }[];
  const out = {} as Record<ConsentPurpose, ConsentState>;
  for (const p of PURPOSES) out[p] = { granted: false, source: null, policyDocKey: null, policyVersion: null, at: null };
  for (const r of rows) out[r.purpose] = { granted: !!r.granted, source: r.source, policyDocKey: r.docKey, policyVersion: r.version, at: r.at };
  return out;
}

/** Marketing email is allowed only with an explicit, current opt-in record. */
export async function marketingAllowed(residentId: string): Promise<boolean> {
  return (await currentConsents({ type: "resident", id: residentId })).marketing_email.granted;
}

/** History for one subject (newest first) — for the person's own view and admin export. */
export async function consentHistory(subject: ConsentSubject, limit = 100) {
  return db
    .prepare(`SELECT purpose, granted, source, policy_doc_key as policyDocKey, policy_version as policyVersion, created_at as at FROM consent_records WHERE subject_type = ? AND subject_id = ? ORDER BY id DESC LIMIT ?`)
    .all(subject.type, subject.id, limit);
}
