import { db } from "./db/index.js";
import { privacyCounts } from "./privacyCounts.js";

// Phase L (docs/participation-expansion/23) — the admin governance summary:
// the existing audit log grouped by theme (configuration, field policy,
// exports, permissions, privacy), with counts and the latest entries — who,
// what and when, never the stored values — plus retention counts (doc 18),
// the privacy-review items still open, and evidence-based indicators worth a
// look. Read only. Each theme links to the audit log filtered to it.

export const GOVERNANCE_THEMES = [
  { key: "configuration", label: "Configuration changes", actions: ["config.%", "org.capabilities_changed", "org.categories_changed", "org.flag_changed", "market_category.changed", "recommendation_weights.updated", "notification_template.%", "taxonomy.%", "help.updated"] },
  { key: "fields", label: "Registration-field policy", actions: ["fields.policy_changed"] },
  { key: "exports", label: "Exports", actions: ["%_exported"] },
  { key: "permissions", label: "Permission changes", actions: ["admin.role_changed", "admin.invited", "admin.invite_%", "admin.mfa_reset", "vendor.platform_role_changed", "vendor.status_changed", "org.staff_%", "partner.suspended"] },
  { key: "privacy", label: "Privacy requests", actions: ["privacy_request.%"] },
] as const;

/** Privacy decisions still open (docs/participation-expansion/18 §1); engineering can't close them. */
export const PRIVACY_REVIEW_ITEMS = [
  { key: "policy_medical_wording", label: "Privacy policy still says medical information is collected at club registration", status: "Waiting for legal review" },
  { key: "legacy_medical_retention", label: "Retention and lawful basis for legacy medical notes", status: "Waiting for legal review" },
  { key: "answer_retention", label: "Retention periods for registration answers (none set)", status: "Waiting for an owner decision" },
  { key: "special_category", label: "Sensitive registration questions (switch locked)", status: "Locked until the policy is approved" },
  { key: "notification_consent", label: "Organiser messages and reminders as service messages (no opt-out for one's own bookings)", status: "Waiting for an owner decision" },
] as const;

const like = (patterns: readonly string[]) => patterns.map(() => "al.action LIKE ?").join(" OR ");

export async function governanceSummary(days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const themes = [];
  for (const t of GOVERNANCE_THEMES) {
    const [{ n }] = (await db
      .prepare(`SELECT COUNT(*) AS n FROM audit_log al WHERE al.created_at >= ? AND (${like(t.actions)})`)
      .all(since, ...t.actions)) as { n: number }[];
    const latest = (await db
      .prepare(
        `SELECT al.action, al.object_type AS objectType, al.object_id AS objectId, al.actor_kind AS actorKind, u.email AS actorEmail, al.created_at AS at
         FROM audit_log al LEFT JOIN users u ON u.id = al.actor_user_id WHERE al.created_at >= ? AND (${like(t.actions)}) ORDER BY al.created_at DESC, al.id DESC LIMIT 8`
      )
      .all(since, ...t.actions)) as { action: string; objectType: string; objectId: string; actorKind: string | null; actorEmail: string | null; at: Date | string }[];
    themes.push({ key: t.key, label: t.label, count: Number(n), latest: latest.map((r) => ({ ...r, at: r.at instanceof Date ? r.at.toISOString() : String(r.at) })) });
  }

  // Evidence-based indicators: heavy exporting by one account in a day, and admin sign-in lockouts.
  const heavyExports = (await db
    .prepare(
      `SELECT u.email AS actorEmail, DATE(al.created_at) AS day, COUNT(*) AS n FROM audit_log al LEFT JOIN users u ON u.id = al.actor_user_id
       WHERE al.created_at >= ? AND al.action LIKE '%_exported' GROUP BY al.actor_user_id, u.email, DATE(al.created_at) HAVING COUNT(*) >= 10 ORDER BY n DESC LIMIT 20`
    )
    .all(since)) as { actorEmail: string | null; day: Date | string; n: number }[];
  const lockouts = (await db
    .prepare(`SELECT u.email AS actorEmail, al.created_at AS at FROM audit_log al LEFT JOIN users u ON u.id = al.object_id WHERE al.created_at >= ? AND al.action = 'admin.mfa_locked' ORDER BY al.created_at DESC LIMIT 20`)
    .all(since)) as { actorEmail: string | null; at: Date | string }[];
  const indicators = [
    ...heavyExports.map((h) => ({ kind: "exports", text: `${h.actorEmail ?? "An account"} downloaded ${Number(h.n)} exports on ${String(h.day instanceof Date ? h.day.toISOString().slice(0, 10) : h.day).slice(0, 10)}` })),
    ...lockouts.map((l) => ({ kind: "lockout", text: `Admin sign-in locked after failed codes: ${l.actorEmail ?? "an admin"} (${l.at instanceof Date ? l.at.toISOString().slice(0, 16).replace("T", " ") : String(l.at)})` })),
  ];

  const retention = await privacyCounts(async (sql, params) => (await db.prepare(sql).all(...(params ?? []))) as Record<string, unknown>[], "current");
  return { days, themes, indicators, retention: { medical: retention.medical, answersPastRetention: retention.answersPastRetention }, privacyReview: PRIVACY_REVIEW_ITEMS };
}
