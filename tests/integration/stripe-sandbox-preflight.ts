import { lstatSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Stripe from "stripe";
import { stripeTestProfileIssues } from "../support/integration-safety";
import { repositoryRoot } from "./runtime";

// Revenue & Connect Stage 5d — read-only Stripe sandbox preflight.
// Loads the opt-in TEST key with the same file checks as `qa:stripe`, never
// prints it, and reports only safe facts: platform account id/country,
// test mode, and whether the Connect / Billing features the sandbox suite
// needs are available. Creates nothing.

async function main() {
  const dir = path.join(os.homedir(), ".config", "hellocircle-qa");
  const file = path.join(dir, "stripe-test.json");
  const dirStat = lstatSync(dir);
  const stat = lstatSync(file);
  if (!dirStat.isDirectory() || (dirStat.mode & 0o077) !== 0) throw new Error("QA SAFETY ABORT: stripe-test directory must be mode 0700.");
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("QA SAFETY ABORT: stripe-test.json must be mode 0600.");
  if (path.resolve(file).startsWith(repositoryRoot)) throw new Error("QA SAFETY ABORT: key file inside repository.");
  const cfg = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const issues = stripeTestProfileIssues(cfg);
  if (issues.length) throw new Error(`QA STRIPE INVALID: ${issues.join(" ")}`);
  const stripe = new Stripe(String(cfg.STRIPE_SECRET_KEY));

  const balance = await stripe.balance.retrieve();
  if (balance.livemode !== false) throw new Error("QA SAFETY ABORT: not a test-mode account.");
  const account = await stripe.accounts.retrieveCurrent();
  const facts: Record<string, unknown> = {
    keyMode: String(cfg.STRIPE_SECRET_KEY).startsWith("rk_") ? "restricted test key" : "secret test key",
    balanceLivemode: balance.livemode,
    platformAccountId: account.id,
    platformCountry: account.country,
    platformDefaultCurrency: account.default_currency,
    platformChargesEnabled: account.charges_enabled,
    platformBusinessName: account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? null,
    availableEur: balance.available.find((b) => b.currency === "eur")?.amount ?? 0,
    pendingEur: balance.pending.find((b) => b.currency === "eur")?.amount ?? 0,
  };
  try {
    const list = await stripe.accounts.list({ limit: 1 });
    facts.connectEnabled = true;
    facts.existingConnectedAccounts = list.data.length > 0 ? "some" : "none";
  } catch (e) {
    facts.connectEnabled = false;
    facts.connectError = (e as { code?: string; type?: string }).code ?? (e as { type?: string }).type ?? "unknown";
  }
  try {
    await stripe.subscriptions.list({ limit: 1 });
    facts.billingReadable = true;
  } catch (e) {
    facts.billingReadable = false;
    facts.billingError = (e as { code?: string }).code ?? "unknown";
  }
  try {
    await stripe.taxRates.list({ limit: 1 });
    facts.taxRatesReadable = true;
  } catch (e) {
    facts.taxRatesReadable = false;
  }
  console.log(JSON.stringify(facts, null, 2));
}

main().catch((e) => {
  // Classified only: never echo messages that could carry request details.
  console.error(e instanceof Error && e.message.startsWith("QA ") ? e.message : `QA STRIPE PREFLIGHT FAILED: ${(e as { type?: string }).type ?? "error"} ${(e as { code?: string }).code ?? ""}`);
  process.exitCode = 1;
});
