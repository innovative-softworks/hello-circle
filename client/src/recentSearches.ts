// Recent + popular searches — one store shared by Explore's search bar and
// Home's hero search, so both suggest the same things and there is still
// only one search system (Explore runs every query and records it here).

export const RECENT_KEY = "hello_circle_recent_searches";

export const POPULAR_SEARCHES = ["Badminton tonight", "Swimming near me", "Free activities this weekend", "Kids art"];

export function loadRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecent(q: string) {
  try {
    const list = [q, ...loadRecent().filter((r) => r !== q)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode) — recents are a convenience only */
  }
}
