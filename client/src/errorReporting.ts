// Client error reporting (UI completion 2026-10-14) — provider-neutral: errors
// go to the app's own POST /api/client-errors, which logs one scrubbed line
// (and forwards it only if the server has ERROR_REPORT_WEBHOOK_URL set).
// Only the route path, error name and a scrubbed message are sent — never
// query strings, form values, storage or user details.

const MAX_PER_PAGE = 10;
let sent = 0;
const seen = new Set<string>();

export function scrubClient(text: string): string {
  return String(text ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, "[key]")
    .replace(/\b\d{12,19}\b/g, "[number]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[token]")
    .slice(0, 500);
}

export function reportClientError(kind: string, error: unknown): void {
  try {
    const e = error as { name?: string; message?: string };
    const message = scrubClient(e?.message ?? String(error));
    if (!message) return;
    const key = `${kind}:${message}`;
    if (seen.has(key) || sent >= MAX_PER_PAGE) return;
    seen.add(key);
    sent += 1;
    const body = JSON.stringify({ kind, name: e?.name ? String(e.name).slice(0, 60) : undefined, message, route: window.location.pathname, release: import.meta.env.VITE_APP_VERSION });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/client-errors", new Blob([body], { type: "application/json" }));
    else void fetch("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* reporting must never cause another failure */
  }
}

export function installErrorReporting(): void {
  window.addEventListener("error", (ev) => reportClientError("window_error", ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => reportClientError("unhandled_rejection", ev.reason));
}
