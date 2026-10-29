import { db } from "./db/index.js";

// Trust & Retention batch 1 — what a profile may claim was checked.
//
// Each label names one specific check and says what it means and what it
// doesn't. A label appears only while the check holds: an email confirmation
// on the account, an approved host application, or an approved, unexpired,
// unrevoked row in verification_checks. Payment, a subscription or a
// commercial tier (users.provider_tier), profile completeness and email
// confirmation are never treated as identity checks, and there is no
// "verified Circle" label: a Circle's organiser carries their own labels,
// which say nothing about members or activities.
//
// Identity checks are not available: HelloCircle has no identity provider,
// access policy or retention policy for identity evidence yet, so the server
// refuses to approve one (IDENTITY_CHECKS) and nothing collects documents.
// verification_checks stores only an admin's written note of what they
// looked at — never a document or an image.

export type CheckType = "business_details" | "identity" | "organiser_identity";
export type SubjectType = "vendor" | "resident";
export type CheckStatus = "pending" | "more_info" | "approved" | "rejected" | "revoked" | "expired";

export const CHECK_SUBJECT: Record<CheckType, SubjectType> = {
  business_details: "vendor",
  identity: "resident",
  organiser_identity: "resident",
};
export const isCheckType = (v: unknown): v is CheckType => typeof v === "string" && Object.prototype.hasOwnProperty.call(CHECK_SUBJECT, v);

export const IDENTITY_UNAVAILABLE =
  "Identity checks aren't available yet. HelloCircle won't collect identity documents until it has chosen a checking provider and set who can see the evidence and how long it is kept.";

/** Which checks HelloCircle can currently perform. */
export const CHECK_AVAILABILITY: Record<CheckType, { available: boolean; why?: string }> = {
  business_details: { available: true },
  identity: { available: false, why: IDENTITY_UNAVAILABLE },
  organiser_identity: { available: false, why: IDENTITY_UNAVAILABLE },
};

export type LabelKey = "email_confirmed" | "host_application_approved" | "business_details_checked" | "identity_checked" | "organiser_identity_checked";

export interface VerificationLabel {
  key: LabelKey;
  label: string;
  meaning: string;
  checkedAt: string | null;
  expiresAt?: string | null;
}

export const LABEL_TEXT: Record<LabelKey, { label: string; meaning: string }> = {
  email_confirmed: {
    label: "Email confirmed",
    meaning: "They confirmed they can receive email at the address on their account. It isn't an identity check.",
  },
  host_application_approved: {
    label: "Host application approved",
    meaning: "HelloCircle read their host application and they agreed to the host guidelines. We didn't check their identity.",
  },
  business_details_checked: {
    label: "Business details checked",
    meaning:
      "HelloCircle checked the business details this provider gave us against an official or public record. It doesn't cover individual staff, safeguarding or every activity they run.",
  },
  identity_checked: {
    label: "Identity checked",
    meaning: "HelloCircle confirmed this person's identity.",
  },
  organiser_identity_checked: {
    label: "Organiser identity checked",
    meaning: "HelloCircle confirmed the identity of this Circle's organiser. It says nothing about the members or the activities.",
  },
};

const CHECK_LABEL: Record<CheckType, LabelKey> = {
  business_details: "business_details_checked",
  identity: "identity_checked",
  organiser_identity: "organiser_identity_checked",
};

function label(key: LabelKey, checkedAt: string | null, expiresAt?: string | null): VerificationLabel {
  return { key, ...LABEL_TEXT[key], checkedAt, ...(expiresAt !== undefined ? { expiresAt } : {}) };
}

/** Approved checks still in force (not revoked, not past their expiry). */
async function heldChecks(subjectType: SubjectType, subjectId: string): Promise<VerificationLabel[]> {
  const rows = (await db
    .prepare(
      `SELECT check_type as checkType, decided_at as decidedAt, expires_at as expiresAt FROM verification_checks
       WHERE subject_type = ? AND subject_id = ? AND status = 'approved' AND (expires_at IS NULL OR expires_at > NOW())`
    )
    .all(subjectType, subjectId)) as { checkType: CheckType; decidedAt: string | null; expiresAt: string | null }[];
  // Never show an identity label while identity checks can't be done.
  return rows.filter((r) => CHECK_AVAILABILITY[r.checkType]?.available).map((r) => label(CHECK_LABEL[r.checkType], r.decidedAt, r.expiresAt));
}

export async function residentLabels(residentId: string): Promise<VerificationLabel[]> {
  const r = (await db.prepare(`SELECT email_verified_at as emailAt, host_status as hostStatus, host_decided_at as hostAt FROM residents WHERE id = ?`).get(residentId)) as
    | { emailAt: string | null; hostStatus: string; hostAt: string | null }
    | undefined;
  if (!r) return [];
  const out: VerificationLabel[] = [];
  if (r.emailAt) out.push(label("email_confirmed", r.emailAt));
  if (r.hostStatus === "verified") out.push(label("host_application_approved", r.hostAt));
  out.push(...(await heldChecks("resident", residentId)));
  return out;
}

export async function vendorLabels(vendorId: string): Promise<VerificationLabel[]> {
  // Vendor accounts have no email-confirmation step, so no email label. A
  // business check is held by the organisation's owner account and applies to
  // every account in that organisation.
  const team = (await db
    .prepare(`SELECT id FROM users WHERE id = ? OR (org_id IS NOT NULL AND org_id = (SELECT org_id FROM users WHERE id = ?))`)
    .all(vendorId, vendorId)) as { id: string }[];
  const seen = new Set<LabelKey>();
  const out: VerificationLabel[] = [];
  for (const m of team) {
    for (const l of await heldChecks("vendor", m.id)) {
      if (!seen.has(l.key)) {
        seen.add(l.key);
        out.push(l);
      }
    }
  }
  return out;
}

/** Marks approved checks whose expiry has passed as expired (frees the open slot). */
export async function expireChecks(): Promise<number> {
  const r = await db
    .prepare(`UPDATE verification_checks SET status = 'expired', open_key = NULL, row_version = row_version + 1 WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at <= NOW()`)
    .run();
  return r.changes;
}

export const openKey = (subjectType: SubjectType, subjectId: string, checkType: CheckType) => `${subjectType}:${subjectId}:${checkType}`;

/** SQL boolean: the vendor (or anyone in its organisation) holds a current
 * business-details check. `vendorIdExpr` is a trusted column expression. */
export function businessCheckedSql(vendorIdExpr: string): string {
  return `EXISTS (SELECT 1 FROM verification_checks vc JOIN users vu ON vu.id = vc.subject_id
    WHERE vc.subject_type = 'vendor' AND vc.check_type = 'business_details' AND vc.status = 'approved' AND (vc.expires_at IS NULL OR vc.expires_at > NOW())
      AND (vu.id = ${vendorIdExpr} OR (vu.org_id IS NOT NULL AND vu.org_id = (SELECT ou.org_id FROM users ou WHERE ou.id = ${vendorIdExpr}))))`;
}

export async function isBusinessChecked(vendorId: string | null | undefined): Promise<boolean> {
  if (!vendorId) return false;
  const r = (await db.prepare(`SELECT ${businessCheckedSql("?")} as ok`).get(vendorId, vendorId)) as { ok: number } | undefined;
  return !!Number(r?.ok);
}
