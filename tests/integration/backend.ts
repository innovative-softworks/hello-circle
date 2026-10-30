import { randomUUID } from "node:crypto";
import net from "node:net";
import http from "node:http";
import { connectedPreflight } from "./runtime";
import { qaPorts, qaWebhookSecretOk } from "../support/integration-safety";

// The run's own ports (QA_PORT_OFFSET, 0 = 13306/4311). The run's DB_PORT and
// PORT must agree with them, or the backend refuses to start.
const QA_DB_PORT = qaPorts(process.env).db;
const QA_API_PORT = qaPorts(process.env).api;
if (process.env.DB_PORT !== String(QA_DB_PORT) || process.env.PORT !== String(QA_API_PORT)) throw new Error("QA SAFETY ABORT: Backend ports don't match the isolated run.");

async function main() {
  const checked = await connectedPreflight();
  await checked.connection.end();
  if (!checked.schemaReady) throw new Error("QA SAFETY ABORT: Seed the isolated schema first.");
  if (process.env.DB_NAME !== checked.env.DB_NAME || process.env.DOTENV_CONFIG_PATH !== `${checked.manifest.secretsDir}/empty.env`) throw new Error("QA SAFETY ABORT: Backend must be started by the sanitized QA runner.");
  // Test-process-only boundary. The real app, routes and database layer remain unchanged.
  const connect = net.Socket.prototype.connect;
  let blockedOutboundAttempts = 0;
  let providerConnections = 0;
  const stripeProfile = process.env.QA_STRIPE_TEST_PROFILE === "1";
  net.Socket.prototype.connect = function (...args: any[]): any {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    // Phase 9 Stripe TEST profile only: HTTPS to the Stripe API, nothing else.
    if (stripeProfile && typeof options === "object" && options.host === "api.stripe.com" && Number(options.port) === 443) {
      providerConnections++;
      return (connect as any).apply(this, args);
    }
    if (typeof options !== "object" || options.host !== "127.0.0.1" || Number(options.port) !== QA_DB_PORT) {
      blockedOutboundAttempts++;
      throw new Error("QA SAFETY ABORT: Backend outbound connection blocked.");
    }
    return (connect as any).apply(this, args);
  };
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args: any[]): any {
    if (Number(args[0]) !== QA_API_PORT) throw new Error("QA SAFETY ABORT: Unexpected backend listener.");
    return (listen as any).call(this, QA_API_PORT, "127.0.0.1", ...args.slice(1));
  };
  // Email's no-SMTP fallback logs token-bearing mail bodies. Never retain app logs in auth QA.
  console.log = console.info = console.warn = console.error = () => {};
  const { db } = await import("../../server/src/db/index");
  // Phase 10A — record ATTEMPTED emails as safe facts only (recipient,
  // subject, link origins, whether a token-style query is present). Bodies
  // and token values are never stored or returned.
  const sentMail: { to: string; subject: string; linkOrigins: string[]; tokenLink: boolean }[] = [];
  const { setQaMailObserver } = await import("../../server/src/email");
  setQaMailObserver((msg) => {
    const urls = `${msg.text} ${msg.cta?.url ?? ""}`.match(/https?:\/\/[^\s<]+/g) ?? [];
    sentMail.push({ to: msg.to.toLowerCase(), subject: msg.subject, linkOrigins: [...new Set(urls.map((u) => { try { return new URL(u).origin; } catch { return "invalid"; } }))], tokenLink: urls.some((u) => /[?&](token|resetToken)=/.test(u)) });
  });
  const { stripe } = await import("../../server/src/stripe");
  if (stripeProfile) {
    if (!stripe || !/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "") || !qaWebhookSecretOk(process.env.STRIPE_WEBHOOK_SECRET)) throw new Error("QA SAFETY ABORT: Stripe test profile misconfigured.");
    // Stage 5d — the Connect secret, when present, must also be a per-run local one; the run tag must be well-formed.
    if (process.env.STRIPE_CONNECT_WEBHOOK_SECRET && !qaWebhookSecretOk(process.env.STRIPE_CONNECT_WEBHOOK_SECRET)) throw new Error("QA SAFETY ABORT: Connect webhook secret must be a per-run local or Stripe CLI test secret.");
    if (process.env.STRIPE_V2_WEBHOOK_SECRET && !qaWebhookSecretOk(process.env.STRIPE_V2_WEBHOOK_SECRET)) throw new Error("QA SAFETY ABORT: v2 webhook secret must be a per-run local or Stripe CLI test secret.");
    if (process.env.HC_QA_STRIPE_RUN && !/^qa_stripe_[a-f0-9]{16}$/.test(process.env.HC_QA_STRIPE_RUN)) throw new Error("QA SAFETY ABORT: malformed Stripe run tag.");
    // Prove TEST mode with the provider itself before any app traffic.
    const balance = await stripe.balance.retrieve();
    if (balance.livemode !== false) throw new Error("QA SAFETY ABORT: Live-mode Stripe account refused.");
  } else if (stripe) throw new Error("QA SAFETY ABORT: Payment provider must be unconfigured.");
  const identity = await db.prepare("SELECT DATABASE() AS databaseName, CURRENT_USER() AS account, @@server_uuid AS serverUuid").get();
  if (identity.databaseName !== checked.manifest.databaseName || identity.account !== "hello_circle_qa@%" || identity.serverUuid !== checked.manifest.serverUuid) throw new Error("QA SAFETY ABORT: Backend pool identity mismatch.");
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event: string | symbol, ...args: any[]): boolean {
    if (event === "request") {
      const [request, response] = args;
      response.setHeader("X-HelloCircle-QA-Run", checked.manifest.runId);
      if (request.url === "/api/__qa/outbound") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(stripeProfile ? { blockedOutboundAttempts, paymentProviderConfigured: true, providerMode: "test", providerConnections } : { blockedOutboundAttempts, paymentProviderConfigured: false }));
        return true;
      }
      // Phase 8 provider seam (QA_PAYMENT_PROVIDER_STUB batches only): drives the
      // application's own provider-outcome handler — success / failure / expired —
      // without any payment provider. Never present in the production app.
      if (request.url === "/api/__qa/provider" && request.method === "POST" && process.env.QA_PAYMENT_PROVIDER_STUB === "1") {
        const chunks: Buffer[] = [];
        request.on("data", (c: Buffer) => chunks.push(c));
        request.on("end", async () => {
          try {
            const { type, ref, outcome } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { type: string; ref: string; outcome: "success" | "failure" | "expired" };
            if (!["booking", "registration", "game", "program", "experience", "pass"].includes(type) || !["success", "failure", "expired"].includes(outcome) || typeof ref !== "string") throw new Error("bad input");
            const { processProviderOutcome } = await import("../../server/src/routes/stripeWebhook");
            // D-10: a payment already held for review is re-read from the provider before it
            // can confirm. A real held payment always has a charge at the provider, so the
            // stub records one for it here (the seam otherwise models no provider state).
            if (outcome === "success") {
              const tables: Record<string, string> = { booking: "bookings", registration: "registrations", game: "game_participants", program: "program_enrollments", experience: "experience_bookings", pass: "passes" };
              const held = (await db.prepare(`SELECT o.stripe_session_id AS sid, r.received_minor AS amount FROM ${tables[type]} o JOIN payment_reviews r ON r.checkout_session_id = o.stripe_session_id AND r.status = 'open' WHERE o.ref = ?`).get(ref)) as { sid: string; amount: number | string | null } | undefined;
              if (held?.sid) {
                const { stubProvider } = await import("../../server/src/payments/provider");
                stubProvider.markPaid(held.sid, Number(held.amount ?? 0));
              }
            }
            await processProviderOutcome(type, ref, outcome);
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ processed: true }));
          } catch {
            response.statusCode = 400;
            response.end(JSON.stringify({ processed: false }));
          }
        });
        return true;
      }
      // D-10 / D-11 (stub batches only): a paid Checkout event for an order's own
      // stub session, delivered through the real webhook pipeline (store once,
      // claim, process, park). `amountMinor` other than the agreed amount gives a
      // case-1 mismatch. Also: a refund made "in the provider's dashboard" and a
      // review sweep on demand (the server runs it every 5 minutes anyway).
      if (request.url === "/api/__qa/payment" && request.method === "POST" && process.env.QA_PAYMENT_PROVIDER_STUB === "1") {
        const chunks: Buffer[] = [];
        request.on("data", (c: Buffer) => chunks.push(c));
        request.on("end", async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { action: string; type?: string; ref?: string; amountMinor?: number; status?: string };
            const tables: Record<string, string> = { booking: "bookings", registration: "registrations", game: "game_participants", program: "program_enrollments", experience: "experience_bookings", pass: "passes" };
            const { stubProvider } = await import("../../server/src/payments/provider");
            const { sweepPaymentReviews } = await import("../../server/src/payments/paymentReview");
            let out: Record<string, unknown> = {};
            if (body.action === "sweep") out = await sweepPaymentReviews();
            else {
              if (!body.type || !tables[body.type] || typeof body.ref !== "string") throw new Error("bad input");
              const [rowsFound] = (await db.prepare(`SELECT stripe_session_id AS sid FROM ${tables[body.type]} WHERE ref = ?`).all(body.ref)) as { sid: string | null }[];
              const sid = rowsFound?.sid;
              if (!sid) throw new Error("no session");
              if (body.action === "paid") {
                const agreed = (await db.prepare(`SELECT amount_minor AS a FROM checkout_agreements WHERE session_id = ?`).get(sid)) as { a: number | string } | undefined;
                const amount = typeof body.amountMinor === "number" ? body.amountMinor : Number(agreed?.a ?? 0);
                stubProvider.markPaid(sid, amount);
                stubProvider.setSessionCharge(sid, amount, "eur", { type: body.type, ref: body.ref });
                const event = { id: `evt_qa_stub_${randomUUID().replace(/-/g, "")}`, type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), livemode: false, account: null, data: { object: { id: sid, object: "checkout.session", payment_status: "paid", amount_total: amount, currency: "eur", payment_intent: `pi_stub_${sid}`, metadata: { type: body.type, ref: body.ref } } } };
                const { beginEvent, finishEvent, failEvent } = await import("../../server/src/payments/webhookEvents");
                const { processStripeEvent } = await import("../../server/src/routes/stripeWebhook");
                const { NeedsReviewError } = await import("../../server/src/commerce/payments");
                const begin = await beginEvent("stripe", event as never, JSON.stringify(event));
                if (begin.action !== "process") out = { result: begin.action };
                else {
                  try {
                    await finishEvent(begin.rowId, await processStripeEvent(event as never));
                    out = { result: "processed", eventId: event.id };
                  } catch (e) {
                    await failEvent(begin.rowId, e, { needsReview: e instanceof NeedsReviewError });
                    out = { result: e instanceof NeedsReviewError ? "parked" : "failed", eventId: event.id };
                  }
                }
              } else if (body.action === "dashboard_refund" && typeof body.amountMinor === "number") {
                out = { refund: stubProvider.addExternalRefund(sid, body.amountMinor, body.status ?? "succeeded") };
              } else throw new Error("bad input");
            }
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(out));
          } catch {
            response.statusCode = 400;
            response.end(JSON.stringify({ ok: false }));
          }
        });
        return true;
      }
      // Stage 5f — stub-only Pro checkout simulation: Stripe "complete" (before the webhook),
      // the webhook confirmation, and a failed renewal. Refused outside the stub profile.
      if (request.url === "/api/__qa/plan" && request.method === "POST" && process.env.QA_PAYMENT_PROVIDER_STUB === "1") {
        const chunks: Buffer[] = [];
        request.on("data", (c: Buffer) => chunks.push(c));
        request.on("end", async () => {
          try {
            const { action, sessionId, subscriptionId } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { action: string; sessionId?: string; subscriptionId?: string };
            const { stubProvider } = await import("../../server/src/payments/provider");
            const subs = await import("../../server/src/commerce/subscriptions");
            if (action === "complete" && typeof sessionId === "string" && sessionId.startsWith("cs_sub_stub_")) stubProvider.checkoutStatuses.set(sessionId, "complete");
            else if (action === "confirm" && typeof sessionId === "string" && sessionId.startsWith("cs_sub_stub_")) {
              // Stripe's order: checkout.session.completed, then customer.subscription.* with the period end.
              const subscription = `sub_stub_${sessionId.slice(12)}`;
              await subs.applySubscriptionCheckout({ id: sessionId, subscription, payment_status: "paid" });
              await subs.applySubscriptionUpdate({ id: subscription, status: "active", current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, cancel_at_period_end: false });
            }
            else if (action === "past_due" && typeof subscriptionId === "string" && subscriptionId.startsWith("sub_stub_")) await subs.applySubscriptionUpdate({ id: subscriptionId, status: "past_due" });
            else throw new Error("bad input");
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ ok: true }));
          } catch {
            response.statusCode = 400;
            response.end(JSON.stringify({ ok: false }));
          }
        });
        return true;
      }
      if (request.method === "GET" && typeof request.url === "string" && request.url.startsWith("/api/__qa/mail?")) {
        const to = (new URL(request.url, "http://127.0.0.1").searchParams.get("to") ?? "").toLowerCase();
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(sentMail.filter((m) => m.to === to)));
        return true;
      }
      // HC-QA-095 — classified provider failures (category/type/code/status/
      // request id only; never messages or keys) so a failed checkout in the
      // Stripe TEST gate records WHY, not just "400".
      if (request.url === "/api/__qa/stripe-failures") {
        import("../../server/src/stripeDiagnostics").then(({ recentStripeFailures }) => {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(recentStripeFailures()));
        });
        return true;
      }
      if (request.url === "/api/__qa/identity") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ ...identity, runId: checked.manifest.runId }));
        return true;
      }
    }
    return (emit as any).call(this, event, ...args);
  };
  await import("../../server/src/index");
  process.stdout.write("QA backend ready: verified real application pool; external network blocked.\n");
}
main().catch(() => { process.stderr.write("QA SAFETY ABORT: Backend startup failed; sensitive application diagnostics suppressed.\n"); process.exit(1); });
