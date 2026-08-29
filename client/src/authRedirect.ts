/** What the visitor was trying to do when sign-in interrupted them — shown
 * as a small context card above the auth form (auth redesign brief's
 * "preserve user intent" screens 15/16: "You're joining Galway Badminton
 * Doubles Circle · 7 members" / "You're joining Badminton Doubles · Sat 29
 * Aug · 2 spots left"). Carried as plain query params rather than a single
 * JSON blob so the URL stays readable/debuggable. */
export interface AuthIntentContext {
  kind: "circle" | "game";
  title: string;
  meta: string;
  badge?: string;
}

/** Builds a /signin destination that returns to the current page after
 * signing in — the contextual "sign in to do X" entry point every
 * join/save/book/start trigger across the app should use instead of
 * sending people to the generic My Life hub (per the auth redesign brief's
 * own "preserve user intent" / "don't require login too early" principles —
 * login should be asked for at the moment of an action that needs it, not
 * up front). Reads window.location directly so call sites don't each need
 * their own useLocation() import just for this. SignIn.tsx only ever
 * honours a same-origin relative path from this (see its own safeReturnTo),
 * so there's nothing here for an attacker to hijack into an open redirect.
 */
export function signInHref(context?: AuthIntentContext): string {
  const path = window.location.pathname + window.location.search;
  const params = new URLSearchParams({ returnTo: path });
  if (context) {
    params.set("ctxKind", context.kind);
    params.set("ctxTitle", context.title);
    params.set("ctxMeta", context.meta);
    if (context.badge) params.set("ctxBadge", context.badge);
  }
  return `/signin?${params.toString()}`;
}

/** Only ever honours a same-origin relative path — never an arbitrary
 * redirect target — to avoid an open redirect via a crafted ?returnTo=. */
export function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/bookings";
  return raw;
}

export function readAuthIntentContext(searchParams: URLSearchParams): AuthIntentContext | null {
  const kind = searchParams.get("ctxKind");
  const title = searchParams.get("ctxTitle");
  if (!kind || !title || (kind !== "circle" && kind !== "game")) return null;
  return { kind, title, meta: searchParams.get("ctxMeta") ?? "", badge: searchParams.get("ctxBadge") ?? undefined };
}
