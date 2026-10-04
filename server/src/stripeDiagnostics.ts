// HC-QA-095 — safe, structured diagnostics for a failed payment-provider call.
//
// A failed Stripe call used to be logged as its raw `message` only: no error
// class, no HTTP status, no request id — so an intermittent checkout failure
// couldn't be told apart as app bug / network / provider. This records WHAT
// failed and WHY in categories, and nothing else: never the message body
// (it can echo request parameters such as an email), never keys, never
// payment details. Every recorded value is shape-checked before use.

export type StripeFailureCategory =
  | "timeout"
  | "connection"
  | "rate_limit"
  | "authentication"
  | "permission"
  | "invalid_request"
  | "idempotency"
  | "card"
  | "provider_api"
  | "unknown";

export interface StripeFailure {
  operation: string;
  category: StripeFailureCategory;
  /** Stripe's raw error type ("invalid_request_error"), else the SDK error class ("StripeAPIError"); shape-checked. */
  type: string | null;
  /** Stripe's error code, e.g. "parameter_invalid_integer" (shape-checked). */
  code: string | null;
  statusCode: number | null;
  /** Stripe's request id ("req_…"), safe to quote to Stripe support. */
  requestId: string | null;
  at: string;
}

const TOKEN = /^[a-z][a-z0-9_]{0,63}$/i;
const REQUEST_ID = /^req_[A-Za-z0-9]{6,64}$/;
const pick = (v: unknown, re: RegExp) => (typeof v === "string" && re.test(v) ? v : null);

const BY_CLASS: Record<string, StripeFailureCategory> = {
  StripeConnectionError: "connection",
  StripeRateLimitError: "rate_limit",
  StripeAuthenticationError: "authentication",
  StripePermissionError: "permission",
  StripeInvalidRequestError: "invalid_request",
  StripeIdempotencyError: "idempotency",
  StripeCardError: "card",
  StripeAPIError: "provider_api",
};
const BY_RAW_TYPE: Record<string, StripeFailureCategory> = {
  api_error: "provider_api",
  card_error: "card",
  idempotency_error: "idempotency",
  invalid_request_error: "invalid_request",
};
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ENETUNREACH", "EHOSTUNREACH"]);
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "ESOCKETTIMEDOUT", "ECONNABORTED"]);

export function classifyStripeError(operation: string, e: unknown): StripeFailure {
  const err = (e ?? {}) as Record<string, unknown>;
  const detail = (err.detail ?? {}) as Record<string, unknown>;
  const sysCode = [err.code, detail.code, (err.cause as Record<string, unknown> | undefined)?.code].find((c) => typeof c === "string") as string | undefined;
  const message = typeof err.message === "string" ? err.message : ""; // read for classification only — never recorded
  const statusCode = typeof err.statusCode === "number" ? err.statusCode : null;

  let category: StripeFailureCategory = BY_CLASS[String(err.type)] ?? BY_RAW_TYPE[String(err.rawType ?? err.type)] ?? "unknown";
  if ((sysCode && TIMEOUT_CODES.has(sysCode)) || (category === "connection" && /time(d)? ?out/i.test(message))) category = "timeout";
  else if (category === "unknown" && sysCode && NETWORK_CODES.has(sysCode)) category = "connection";
  else if (category === "unknown" && statusCode === 429) category = "rate_limit";
  else if (category === "unknown" && statusCode !== null && statusCode >= 500) category = "provider_api";

  return {
    operation: pick(operation, /^[a-z][a-z0-9_.-]{0,63}$/i) ?? "unknown",
    category,
    type: pick(err.rawType, TOKEN) ?? pick(err.type, TOKEN),
    code: pick(err.code, TOKEN) ?? (sysCode && (NETWORK_CODES.has(sysCode) || TIMEOUT_CODES.has(sysCode)) ? sysCode : null),
    statusCode,
    requestId: pick(err.requestId, REQUEST_ID) ?? pick(err.request_id, REQUEST_ID),
    at: new Date().toISOString(),
  };
}

const RECENT_LIMIT = 50;
const recent: StripeFailure[] = [];

/** Classifies, logs one structured line, and remembers the failure (bounded). */
export function recordStripeFailure(operation: string, e: unknown): StripeFailure {
  const f = classifyStripeError(operation, e);
  recent.push(f);
  if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT);
  console.error(
    `[stripe] ${f.operation} failed category=${f.category} type=${f.type ?? "-"} code=${f.code ?? "-"} status=${f.statusCode ?? "-"} request_id=${f.requestId ?? "-"}`,
  );
  return f;
}

/** The most recent classified failures (newest last) — operational diagnostics only. */
export function recentStripeFailures(): StripeFailure[] {
  return recent.slice();
}
