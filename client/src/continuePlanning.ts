// Home's "Continue Planning" module (IA spec §3) — a lightweight, client-
// only draft of an in-progress Make It Happen search, so Home can offer to
// resume it instead of the user losing their place. Deliberately not a
// server-persisted "draft booking" concept (that's a much bigger feature);
// this is the same top-level-utility convention as clientId.ts/favorites.ts.

const KEY = "hello_circle_continue_planning";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ContinuePlanningDraft {
  activityLabel: string;
  county: string;
  date: string;
  time: string;
  savedAt: number;
}

export function saveContinuePlanning(draft: Omit<ContinuePlanningDraft, "savedAt">): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // localStorage unavailable (private browsing etc.) — never block the flow over this.
  }
}

export function readContinuePlanning(): ContinuePlanningDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as ContinuePlanningDraft;
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function clearContinuePlanning(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
