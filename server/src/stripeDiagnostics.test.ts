import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyStripeError, recentStripeFailures, recordStripeFailure } from "./stripeDiagnostics.js";

// HC-QA-095 — provider failures are classified (so an intermittent checkout
// failure says app / network / provider), and nothing sensitive is recorded.

const E = Stripe.errors;
// A key-SHAPED fake, assembled at runtime so no secret-like literal sits in source.
const fakeKey = ["sk", "test", "FAKE0000000000000000"].join("_");
const leakyMessage = `No such customer for qa_person@example.test using ${fakeKey}`;

afterEach(() => { vi.restoreAllMocks(); });

describe("classifyStripeError", () => {
  it("invalid request: category, type, code, status and request id — never the message", () => {
    const f = classifyStripeError("checkout.create.booking", new E.StripeInvalidRequestError({ message: leakyMessage, type: "invalid_request_error", code: "parameter_invalid_integer", statusCode: 400, requestId: "req_AbC123xyz" } as never));
    expect(f).toMatchObject({ operation: "checkout.create.booking", category: "invalid_request", type: "invalid_request_error", code: "parameter_invalid_integer", statusCode: 400, requestId: "req_AbC123xyz" });
    expect(JSON.stringify(f)).not.toMatch(/example\.test|sk_test|No such customer/);
  });

  it("separates timeout, connection, rate limit, auth and provider-side errors", () => {
    expect(classifyStripeError("x", new E.StripeConnectionError({ message: "Request aborted due to timeout being reached (80000ms)" } as never)).category).toBe("timeout");
    expect(classifyStripeError("x", new E.StripeConnectionError({ message: "An error occurred with our connection to Stripe." } as never)).category).toBe("connection");
    expect(classifyStripeError("x", new E.StripeRateLimitError({ message: "Too many requests", statusCode: 429 } as never)).category).toBe("rate_limit");
    expect(classifyStripeError("x", new E.StripeAuthenticationError({ message: "Invalid API Key provided: sk_test_****" } as never)).category).toBe("authentication");
    expect(classifyStripeError("x", new E.StripeAPIError({ message: "Something went wrong", statusCode: 500 } as never)).category).toBe("provider_api");
    expect(classifyStripeError("x", new E.StripeIdempotencyError({ message: "Keys for idempotent requests can only be used with the same parameters" } as never)).category).toBe("idempotency");
  });

  it("plain Node network errors (no Stripe wrapper) are classified by their system code", () => {
    expect(classifyStripeError("x", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))).toMatchObject({ category: "connection", code: "ECONNRESET" });
    expect(classifyStripeError("x", Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toMatchObject({ category: "timeout", code: "ETIMEDOUT" });
    expect(classifyStripeError("x", new Error("boom"))).toMatchObject({ category: "unknown", code: null, requestId: null });
    expect(classifyStripeError("x", undefined).category).toBe("unknown");
  });

  it("rejects values that don't have the expected shape (no free text smuggled into the record)", () => {
    const f = classifyStripeError("checkout.create.booking", Object.assign(new Error("x"), { type: "has spaces; and stuff", code: "a b c <script>", requestId: "not-a-request-id", statusCode: "400" }));
    expect(f).toMatchObject({ type: null, code: null, requestId: null, statusCode: null });
  });
});

describe("recordStripeFailure", () => {
  it("logs one structured line without the message, and keeps a bounded recent list", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 60; i++) recordStripeFailure("checkout.create.game", new E.StripeAPIError({ message: leakyMessage, statusCode: 502, requestId: `req_bounded${i}` } as never));
    const line = String(log.mock.calls.at(-1)?.[0]);
    expect(line).toBe("[stripe] checkout.create.game failed category=provider_api type=StripeAPIError code=- status=502 request_id=req_bounded59");
    expect(log.mock.calls.flat().join("\n")).not.toMatch(/example\.test|sk_test|No such customer/);
    const recent = recentStripeFailures();
    expect(recent.length).toBe(50);
    expect(recent.at(-1)?.requestId).toBe("req_bounded59");
  });
});
