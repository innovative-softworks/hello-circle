import { APP_COMMIT, APP_VERSION } from "./appVersion.js";

// Provider-neutral error reporting (UI completion 2026-10-14). HelloCircle has
// no monitoring service. Every report becomes one structured log line
// (`[error-report] {...}`), which any log shipper can pick up. If
// ERROR_REPORT_WEBHOOK_URL is set, the same JSON is POSTed there (a Sentry
// relay, an incident webhook, …) — best effort, never blocking, never thrown.
//
// Privacy: no request bodies, cookies, headers or query strings; emails,
// tokens, card-like numbers and Stripe/credential-looking strings are masked.

export interface ErrorReport {
  source: "server" | "client";
  kind: string;
  message: string;
  name?: string;
  route?: string;
  status?: number;
  release?: string;
}

const MASKS: [RegExp, string][] = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, "[key]"],
  [/\bwhsec_[A-Za-z0-9]+/g, "[secret]"],
  [/\b(cs|pi|ch|re|acct|cus|evt)_(live|test)?_?[A-Za-z0-9]{8,}/g, "[$1_id]"],
  [/\b\d{12,19}\b/g, "[number]"],
  [/\b[a-f0-9]{32,}\b/gi, "[token]"],
  [/(password|token|secret|authorization)=\S+/gi, "$1=[redacted]"],
];

export function scrub(text: string, max = 500): string {
  let out = String(text ?? "");
  for (const [re, rep] of MASKS) out = out.replace(re, rep);
  return out.slice(0, max);
}

/** Path only — never the query string (it can carry tokens or refs). */
export function scrubRoute(route: string | undefined): string | undefined {
  if (!route) return undefined;
  return scrub(route.split("?")[0].split("#")[0], 200);
}

export function buildReport(input: ErrorReport): ErrorReport & { at: string; release: string } {
  return {
    source: input.source,
    kind: scrub(input.kind, 60),
    message: scrub(input.message),
    name: input.name ? scrub(input.name, 60) : undefined,
    route: scrubRoute(input.route),
    status: input.status,
    release: input.release ? scrub(input.release, 60) : `${APP_VERSION}+${APP_COMMIT}`,
    at: new Date().toISOString(),
  };
}

export function reportError(input: ErrorReport): void {
  const report = buildReport(input);
  console.error(`[error-report] ${JSON.stringify(report)}`);
  const url = process.env.ERROR_REPORT_WEBHOOK_URL;
  if (!url) return;
  void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report), signal: AbortSignal.timeout(3000) }).catch(() => {
    /* reporting must never cause another failure */
  });
}

/** Convenience for caught exceptions. */
export function reportException(kind: string, err: unknown, extra: { route?: string; status?: number } = {}): void {
  const e = err as { name?: string; message?: string };
  reportError({ source: "server", kind, name: e?.name, message: e?.message ?? String(err), ...extra });
}
