export type QaEnvironment = {
  mode: "mock" | "live-readonly";
  environment: "local" | "staging";
  baseURL: string;
};

function abort(message: string): never {
  throw new Error(`QA ABORTED — ${message}`);
}

/** Never reads application .env files or starts the API (startup migrates/seeds). */
export function resolveEnvironment(env: Record<string, string | undefined>): QaEnvironment {
  if (env.NODE_ENV?.trim().toLowerCase() === "production") abort("environment appears to be production (NODE_ENV). No QA execution is permitted.");
  if (env.E2E_MODE !== "mock" && env.E2E_MODE !== "live-readonly") {
    abort("Set E2E_MODE=mock or live-readonly; mutation suites are not enabled.");
  }
  if (env.E2E_ENVIRONMENT !== "local" && env.E2E_ENVIRONMENT !== "staging") {
    abort("Set E2E_ENVIRONMENT=local or staging; production is not supported yet.");
  }
  if (!env.E2E_BASE_URL) abort("E2E_BASE_URL is required.");
  let url: URL;
  try { url = new URL(env.E2E_BASE_URL); } catch { abort("E2E_BASE_URL must be an HTTP(S) origin."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    abort("E2E_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (["hellocircle.ie", "www.hellocircle.ie"].includes(url.hostname.replace(/\.$/, ""))) {
    abort("environment appears to be production (known production origin).");
  }
  if (env.E2E_ENVIRONMENT === "local" && !loopback) abort("Local QA requires a literal loopback host.");
  if (env.E2E_ENVIRONMENT === "staging" && (loopback || url.protocol !== "https:" || env.E2E_STAGING_ORIGIN !== url.origin)) {
    abort("Staging requires HTTPS and E2E_STAGING_ORIGIN matching the exact approved origin.");
  }
  if (env.E2E_MODE === "mock" && (env.E2E_ENVIRONMENT !== "local" || url.origin !== "http://127.0.0.1:4177")) {
    abort("Mock mode requires local http://127.0.0.1:4177 (isolated frontend, no API proxy).");
  }
  return { mode: env.E2E_MODE, environment: env.E2E_ENVIRONMENT, baseURL: url.origin };
}

// Explicit read endpoints only: do not infer that every GET is non-mutating.
export const readOnlyApiPaths = new Set([
  "/api/health", "/api/config", "/api/auth/me", "/api/guest/me",
  "/api/residents/me/participation", "/api/vendor/listings", "/api/admin/stats",
]);

export function allowedReadRequest(method: string, rawUrl: string, baseURL: string): boolean {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return false; }
  if (url.origin !== baseURL || !["GET", "HEAD"].includes(method)) return false;
  if (url.username || url.password || url.hash || url.pathname.includes("%") || url.pathname.includes("//")) return false;
  if (/^\/api(?:\/|$)/i.test(url.pathname)) return !url.search && readOnlyApiPaths.has(url.pathname);
  return true;
}
