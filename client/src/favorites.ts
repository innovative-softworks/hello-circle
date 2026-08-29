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

export type FavoriteKind = "centre" | "club" | "game" | "program_session" | "club_session" | "experience" | "circle";

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
