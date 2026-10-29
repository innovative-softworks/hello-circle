// Trust & Retention — "Who welcomes newcomers": one short, host- or
// partner-written line per listing (a role or first name and where to find
// them on arrival). Public, so it must never carry contact details: phone
// numbers and email addresses are refused rather than published. Saved
// through each listing type's own create/edit handler; NULL = not provided.

export const NEWCOMER_WELCOME_MAX = 300;

export type NewcomerResult = { ok: true; value: string | null | undefined } | { ok: false; error: string };

/** undefined = leave unchanged; "" or null = clear; otherwise the trimmed text. */
export function parseNewcomerWelcome(v: unknown): NewcomerResult {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: "Who welcomes newcomers must be text" };
  const text = v.trim().replace(/\s+/g, " ");
  if (!text) return { ok: true, value: null };
  if (text.length > NEWCOMER_WELCOME_MAX) return { ok: false, error: `Keep who welcomes newcomers under ${NEWCOMER_WELCOME_MAX} characters` };
  if (/\S+@\S+\.\S+/.test(text)) return { ok: false, error: "Don't include an email address in who welcomes newcomers — it's shown publicly" };
  if ((text.match(/\d/g) ?? []).length >= 7 && /(\+?\d[\d\s().-]{6,}\d)/.test(text)) {
    return { ok: false, error: "Don't include a phone number in who welcomes newcomers — it's shown publicly" };
  }
  return { ok: true, value: text };
}

type Conn = { prepare: (sql: string) => { run: (...p: unknown[]) => Promise<unknown> } };

/** Writes a parsed value (undefined = leave as it is). `table` is one of the five listing tables. */
export async function saveNewcomerWelcome(conn: Conn, table: "games" | "experiences" | "programs" | "clubs" | "centres", id: string, value: string | null | undefined) {
  if (value === undefined) return;
  await conn.prepare(`UPDATE ${table} SET newcomer_welcome = ? WHERE id = ?`).run(value, id);
}
