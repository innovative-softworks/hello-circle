// Privacy review counts (docs/participation-expansion/18) — aggregate numbers
// only, for an authorised operator preparing the D-A4 / retention review.
//
// - Counts legacy club-registration medical notes (registrations.medical) and,
//   when a retention period is set, registration answers past it.
// - Never selects, returns or prints a note, an answer, a name, an email or a
//   booking reference: every query is COUNT/MIN/MAX over dates.
// - The caller runs it inside a READ ONLY transaction (scripts/privacyCounts.ts)
//   so the database refuses any write; nothing is deleted or changed.

export type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

export interface PrivacyCounts {
  database: string;
  medical: { columnPresent: boolean; registrations: number; withNote: number; byYear: { year: number; withNote: number }[]; firstMonth: string | null; lastMonth: string | null };
  answersPastRetention: { class: string; retentionDays: number; answers: number }[] | "no retention period set";
}

const num = (v: unknown) => Number(v ?? 0);
const month = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 7) : null);

export async function privacyCounts(q: Query, database: string): Promise<PrivacyCounts> {
  const [col] = await q(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'registrations' AND COLUMN_NAME = 'medical'`);
  const columnPresent = num(col?.n) === 1;
  let medical: PrivacyCounts["medical"] = { columnPresent, registrations: 0, withNote: 0, byYear: [], firstMonth: null, lastMonth: null };
  if (columnPresent) {
    const [t] = await q(`SELECT COUNT(*) AS total, SUM(medical <> '') AS withNote, MIN(CASE WHEN medical <> '' THEN created_at END) AS firstAt, MAX(CASE WHEN medical <> '' THEN created_at END) AS lastAt FROM registrations`);
    const years = await q(`SELECT YEAR(created_at) AS y, COUNT(*) AS n FROM registrations WHERE medical <> '' GROUP BY YEAR(created_at) ORDER BY y`);
    medical = { columnPresent, registrations: num(t?.total), withNote: num(t?.withNote), byYear: years.map((r) => ({ year: num(r.y), withNote: num(r.n) })), firstMonth: month(t?.firstAt), lastMonth: month(t?.lastAt) };
  }
  let answersPastRetention: PrivacyCounts["answersPastRetention"] = "no retention period set";
  const [hasPolicy] = await q(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'field_policies'`);
  if (num(hasPolicy?.n) === 1) {
    const [row] = await q(`SELECT policy_json FROM field_policies WHERE id = 1`);
    let classes: Record<string, { retentionDays?: number | null }> = {};
    try {
      classes = (JSON.parse(String(row?.policy_json ?? "null")) as { classes?: typeof classes } | null)?.classes ?? {};
    } catch {
      classes = {};
    }
    const set = Object.entries(classes).filter(([, c]) => typeof c?.retentionDays === "number" && c.retentionDays > 0);
    if (set.length) {
      answersPastRetention = [];
      for (const [cls, c] of set) {
        const [r] = await q(
          `SELECT COUNT(*) AS n FROM registration_answers a JOIN registration_questions qq ON qq.id = a.question_id
           JOIN experience_bookings eb ON a.source_type = 'experience' AND eb.ref = a.source_ref JOIN experience_sessions es ON es.id = eb.session_id
           WHERE qq.category = ? AND es.date < DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
          [cls, c.retentionDays]
        );
        answersPastRetention.push({ class: cls, retentionDays: Number(c.retentionDays), answers: num(r?.n) });
      }
    }
  }
  return { database, medical, answersPastRetention };
}
