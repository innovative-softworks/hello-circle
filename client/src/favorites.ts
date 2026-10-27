const KEY = "hello_circle_favorites";

function readAll(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function writeAll(ids: Set<string>) {
  localStorage.setItem(KEY, JSON.stringify([...ids]));
}

export type FavoriteKind = "centre" | "club" | "game" | "program" | "program_session" | "club_session" | "experience" | "circle";

export function isFavorite(kind: FavoriteKind, id: string): boolean {
  return readAll().has(`${kind}:${id}`);
}

export function toggleFavorite(kind: FavoriteKind, id: string): boolean {
  const all = readAll();
  const key = `${kind}:${id}`;
  const next = !all.has(key);
  if (next) all.add(key);
  else all.delete(key);
  writeAll(all);
  return next;
}

/** Detail-page audit DP-32 (2026-10-22) — a visitor's saves live only in this
 * browser. On sign-in they are copied to the account and the local list is
 * cleared, so they show in Saved and follow the person across devices. Only
 * entries whose push succeeded are removed; a failed one stays for next time. */
export async function mergeLocalFavorites(add: (kind: FavoriteKind, id: string) => Promise<unknown>): Promise<number> {
  const all = readAll();
  if (all.size === 0) return 0;
  let merged = 0;
  for (const entry of [...all]) {
    const i = entry.indexOf(":");
    if (i <= 0) {
      all.delete(entry);
      continue;
    }
    try {
      await add(entry.slice(0, i) as FavoriteKind, entry.slice(i + 1));
      all.delete(entry);
      merged++;
    } catch {
      // keep it for the next sign-in
    }
  }
  try {
    writeAll(all);
  } catch {
    // storage unavailable — nothing else to do
  }
  return merged;
}
