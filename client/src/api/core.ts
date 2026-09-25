import { getClientId } from "../clientId";

/** Thrown instead of a plain Error so callers that need more than the
 * message (e.g. registrations.ts's `{ error, full: true }` on a capacity
 * conflict) can inspect the parsed response body without a second fetch. */
export class ApiError extends Error {
  body: Record<string, unknown>;
  constructor(message: string, body: Record<string, unknown>) {
    super(message);
    this.body = body;
  }
}

// --- Centralised session-expiry detection -----------------------------------
// A 401 means two very different things depending on which endpoint sent it:
// on a login/signup/verify attempt it means "these credentials/this token
// didn't check out" (an ordinary, expected failure the calling form already
// shows inline); on anything else it means the caller's *existing* session
// cookie stopped being valid mid-use (expired, revoked, deactivated) — that
// one deserves a single, app-wide "you were signed out" recovery flow rather
// than however that particular call site happens to render a thrown error.
// See SessionExpiryBanner.tsx, the one place that registers a handler.
export type SessionKind = "vendor" | "resident";
type SessionExpiredHandler = (kind: SessionKind, path: string) => void;
let sessionExpiredHandler: SessionExpiredHandler | null = null;

/** Registered once, by the single app-wide SessionExpiryBanner instance. */
export function setSessionExpiredHandler(handler: SessionExpiredHandler | null): void {
  sessionExpiredHandler = handler;
}

// Endpoints where a 401 is an expected outcome of the attempt itself, not a
// sign that a previously-valid session died — never treated as a session
// expiry. Prefix-matched.
const AUTH_ATTEMPT_PREFIXES = [
  "/auth/login",
  "/auth/signup",
  "/auth/google",
  "/auth/link-google",
  "/auth/accept-invite",
  "/auth/request-reset",
  "/auth/reset-password",
  "/guest/login",
  "/guest/signup",
  "/guest/google",
  "/guest/request-link",
  "/guest/verify",
  "/guest/request-password-reset",
  "/guest/reset-password",
  "/residents/me/google",
];
// A 401 on any of these belongs to the vendor/admin (req.user) session; every
// other authenticated path belongs to the resident/guest session.
const VENDOR_SCOPED_PREFIXES = ["/auth/", "/vendor/", "/admin/", "/org/", "/invites/"];

function reportIfSessionExpired(path: string, status: number): void {
  if (status !== 401 || !sessionExpiredHandler) return;
  if (AUTH_ATTEMPT_PREFIXES.some((p) => path.startsWith(p))) return;
  sessionExpiredHandler(VENDOR_SCOPED_PREFIXES.some((p) => path.startsWith(p)) ? "vendor" : "resident", path);
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": getClientId(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    reportIfSessionExpired(path, res.status);
    throw new ApiError(body.error || `Request failed: ${res.status}`, body);
  }
  return res.json() as Promise<T>;
}

/** "Add to calendar" (IA spec §13) — the .ics routes need the same
 * X-Client-Id/cookie auth as `request()`, but return text/calendar, not
 * JSON, so this triggers a browser download instead of parsing a body. */
export async function downloadIcs(path: string, filename: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "X-Client-Id": getClientId() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || `Request failed: ${res.status}`, body);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** "Download my data" — same shape as downloadIcs above, for a JSON export
 * instead of a .ics file. */
export async function downloadJson(path: string, filename: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "X-Client-Id": getClientId() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || `Request failed: ${res.status}`, body);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
