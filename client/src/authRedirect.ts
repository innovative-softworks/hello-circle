/** What the visitor was trying to do when sign-in interrupted them — shown
 * as a small context card above the auth form (auth redesign brief's
 * "preserve user intent" screens 15/16: "You're joining Galway Badminton
 * Doubles Circle · 7 members" / "You're joining Badminton Doubles · Sat 29
 * Aug · 2 spots left"). Carried as plain query params rather than a single
 * JSON blob so the URL stays readable/debuggable. */
export interface AuthIntentContext {
  kind: "circle" | "game" | "activity";
  title: string;
  meta: string;
  badge?: string;
}

/** Every route that is itself part of the auth flow — a validated `returnTo`
 * must never point back at one of these, or a session-expiry/login redirect
 * could loop (land you on an auth page whose own success handler sends you
 * right back to that same auth page). Prefix-matched, so `/signin/create`
 * and `/signin/email-link` are covered by the `/signin` entry. */
const AUTH_PAGE_PATHS = ["/login", "/signin", "/accept-invite", "/forgot-password", "/reset-password", "/vendor/signup"];

function isAuthPagePath(path: string): boolean {
  return AUTH_PAGE_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Captures the current location as a same-origin relative path — pathname,
 * query, and hash — for embedding as `returnTo`. Pulled out so every capture
 * point (this file's own buildAuthHref, and AuthForms.tsx's EmailLinkForm,
 * which needs the same capture for the modal SignInPanel case where there's
 * no page navigation to read a `returnTo` param back from) stays in sync. */
export function currentLocationAsReturnTo(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

function buildAuthHref(base: string, context?: AuthIntentContext): string {
  const path = currentLocationAsReturnTo();
  const params = new URLSearchParams({ returnTo: path });
  if (context) {
    params.set("ctxKind", context.kind);
    params.set("ctxTitle", context.title);
    params.set("ctxMeta", context.meta);
    if (context.badge) params.set("ctxBadge", context.badge);
  }
  return `${base}?${params.toString()}`;
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
 * so there's nothing here for an attacker to hijack into an open redirect. */
export function signInHref(context?: AuthIntentContext): string {
  return buildAuthHref("/signin", context);
}

/** Sibling of signInHref for the resident create-account screen — same
 * intent-preservation shape, so a header/CTA "Join HelloCircle" entry point
 * returns to wherever it was clicked from, exactly like "Sign in" does. */
export function signUpHref(context?: AuthIntentContext): string {
  return buildAuthHref("/signin/create", context);
}

/** Vendor/admin equivalent of signInHref — same shape, different base path
 * and identity system (req.user, not req.resident). Used for a cold deep
 * link into /vendor or /admin with no session, and for the session-expiry
 * banner when a vendor/admin cookie has died mid-use (see
 * SessionExpiryBanner.tsx), so re-authenticating returns to the exact
 * dashboard screen instead of always landing on the tab default. */
export function vendorLoginHref(): string {
  return buildAuthHref("/login");
}

/** Only ever honours a same-origin relative path that isn't itself an auth
 * page — never an arbitrary redirect target (open-redirect guard) and never
 * a path that would bounce straight back into the sign-in flow (loop guard:
 * a `returnTo` of `/login` or `/signin` is never useful — the person is
 * about to land on exactly the page they're leaving). `fallback` lets a
 * caller pick the right default for its own context (residents default to
 * "/bookings"; the vendor/admin side passes its own dashboard root). */
export function safeReturnTo(raw: string | null, fallback = "/bookings"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  // Browsers normalise a backslash to a slash in URLs, so "/\evil.com" is
  // really "//evil.com"; control characters have no business in a path.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  if (isAuthPagePath(raw.split("?")[0].split("#")[0])) return fallback;
  return raw;
}

export function readAuthIntentContext(searchParams: URLSearchParams): AuthIntentContext | null {
  const kind = searchParams.get("ctxKind");
  const title = searchParams.get("ctxTitle");
  if (!kind || !title || (kind !== "circle" && kind !== "game" && kind !== "activity")) return null;
  return { kind, title, meta: searchParams.get("ctxMeta") ?? "", badge: searchParams.get("ctxBadge") ?? undefined };
}
