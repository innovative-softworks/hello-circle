import net from "node:net";
import http from "node:http";
import { connectedPreflight } from "./runtime";

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
    if (typeof options !== "object" || options.host !== "127.0.0.1" || Number(options.port) !== 13306) {
      blockedOutboundAttempts++;
      throw new Error("QA SAFETY ABORT: Backend outbound connection blocked.");
    }
    return (connect as any).apply(this, args);
  };
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args: any[]): any {
    if (Number(args[0]) !== 4311) throw new Error("QA SAFETY ABORT: Unexpected backend listener.");
    return (listen as any).call(this, 4311, "127.0.0.1", ...args.slice(1));
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
    if (!stripe || !/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "") || !/^whsec_qa_[a-f0-9]{64}$/.test(process.env.STRIPE_WEBHOOK_SECRET ?? "")) throw new Error("QA SAFETY ABORT: Stripe test profile misconfigured.");
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
      if (request.method === "GET" && typeof request.url === "string" && request.url.startsWith("/api/__qa/mail?")) {
        const to = (new URL(request.url, "http://127.0.0.1").searchParams.get("to") ?? "").toLowerCase();
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(sentMail.filter((m) => m.to === to)));
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
