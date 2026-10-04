import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripeTestProfileIssues } from "../support/integration-safety";
import { acquireRunLock, childEnvironment, connectedPreflight, repositoryRoot } from "./runtime";
async function main() {
  const checked = await connectedPreflight();
  await checked.connection.end();
  if (!checked.schemaReady) throw new Error("QA SAFETY ABORT: Schema/personas must be seeded explicitly first.");
  const args = process.argv.slice(2);
  const authorization = args[0] === "authorization";
  const gate = args[0] === "security-gate";
  const lifecycle = args[0] === "lifecycle";
  const booking = args[0] === "booking";
  const stripeMode = args[0] === "stripe";
  const product = args[0] === "product";
  const browsers = args[0] === "browsers";
  if (authorization || gate || lifecycle || booking || stripeMode || product || browsers) args.shift();
  // Phase 10A — cross-browser critical journeys. Only these three engine
  // names are accepted; anything else falls back to Chromium.
  const qaBrowser = ["firefox", "webkit"].includes(process.env.QA_BROWSER ?? "") ? process.env.QA_BROWSER! : "chromium";
  // Phase 9 — opt-in Stripe TEST-mode profile. The only provider credential the
  // harness ever accepts: a test-mode secret key in ~/.config/hellocircle-qa/stripe-test.json
  // (regular file, mode 0600). Webhooks are signed with a fresh per-run local
  // secret, verified by the real handler. Values are never printed.
  let stripeEnv: Record<string, string> = {};
  if (stripeMode) {
    // Outside the repository AND outside the QA secrets dir (which is bind-mounted
    // into the MySQL container): the provider key never reaches the database host.
    const dir = path.join(os.homedir(), ".config", "hellocircle-qa");
    const file = path.join(dir, "stripe-test.json");
    let stat, dirStat;
    try { dirStat = lstatSync(dir); stat = lstatSync(file); } catch { throw new Error("QA STRIPE NOT CONFIGURED: ~/.config/hellocircle-qa/stripe-test.json is missing."); }
    if (!dirStat.isDirectory() || (dirStat.mode & 0o077) !== 0) throw new Error("QA SAFETY ABORT: stripe-test directory must be mode 0700.");
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("QA SAFETY ABORT: stripe-test.json must be a regular file with mode 0600.");
    if (path.resolve(file).startsWith(repositoryRoot)) throw new Error("QA SAFETY ABORT: stripe-test.json must live outside the repository.");
    let cfg: Record<string, unknown>;
    try { cfg = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("QA STRIPE INVALID: stripe-test.json is not valid JSON."); }
    const issues = stripeTestProfileIssues(cfg);
    if (issues.length) throw new Error(`QA STRIPE INVALID: ${issues.join(" ")}`);
    stripeEnv = { STRIPE_SECRET_KEY: String(cfg.STRIPE_SECRET_KEY), STRIPE_WEBHOOK_SECRET: `whsec_qa_${randomBytes(32).toString("hex")}`, QA_STRIPE_TEST_PROFILE: "1" };
  }
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--list") continue;
    if (["--grep", "--grep-invert"].includes(args[index]) && args[index + 1] && !args[index + 1].startsWith("--")) { index++; continue; }
    throw new Error("QA SAFETY ABORT: Only --list, --grep and --grep-invert filters are allowed; safety/artifact settings cannot be overridden.");
  }
  const prodBuild = process.env.QA_PROD_BUILD === "1";
  const release = acquireRunLock();
  try {
    if (prodBuild) {
      // Build the production client bundle once (isolated config: no client/.env,
      // providers disabled) into the gitignored QA data directory.
      const built = await new Promise<number>((resolve, reject) => {
        const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "tests/integration/vite.config.ts", "--outDir", "../.qa-data/prod-build", "--emptyOutDir"], { cwd: repositoryRoot, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR }, stdio: "ignore" });
        child.once("error", reject); child.once("exit", (status) => resolve(status ?? 1));
      });
      if (built !== 0) throw new Error("QA SAFETY ABORT: production client build failed.");
      console.log("Production client bundle built for QA_PROD_BUILD batches.");
    }
    // Fresh real backend per bounded batch: respect (never disable) the production
    // shared 10-attempt password limiter. Stop at the first red batch, no retries.
    // Permanent security regression gate: the preserved HC-QA-002..016
    // regressions (and HC-QA-002's focused remediation cases), unfiltered.
    // Phase 7 product-lifecycle suites: same guards, one fresh backend per
    // file so each batch stays within the real 10-login password limiter.
    // Phase 8 booking-integrity suites (no payment provider), same guards.
    const batches = browsers ? [
      // Critical journeys, re-run per engine (no Stripe financial batches).
      ["core", "(auth|passwordless-security)\\.spec\\.ts$"],
      ["product-vendor-signup", "product-vendor-signup\\.spec\\.ts$"],
      ["lifecycle-ui-desktop", "lifecycle-ui-desktop\\.spec\\.ts$"],
      ["lifecycle-ui-responsive", "lifecycle-ui-responsive\\.spec\\.ts$"],
      ["lifecycle-ui-bottom-chrome", "lifecycle-ui-bottom-chrome\\.spec\\.ts$"],
      ["booking-ui", "booking-ui\\.spec\\.ts$"],
      ["product-circles-c", "product-circles-c\\.spec\\.ts$"],
      ["product-host", "product-host\\.spec\\.ts$"],
      ["product-vendor", "product-vendor\\.spec\\.ts$"],
      ["product-states", "product-states\\.spec\\.ts$"],
      ["product-a11y-a", "product-a11y-a\\.spec\\.ts$"],
      ["product-a11y-b", "product-a11y-b\\.spec\\.ts$"],
      ["product-a11y-c", "product-a11y-c\\.spec\\.ts$"],
      ["product-a11y-d", "product-a11y-d\\.spec\\.ts$"],
      ["product-a11y-e", "product-a11y-e\\.spec\\.ts$"],
      ["product-p12-a", "product-p12-a\\.spec\\.ts$"],
      ["product-p12-b", "product-p12-b\\.spec\\.ts$"],
      ["product-deploy", "product-deploy\\.spec\\.ts$"],
      ["product-gaps-ui", "product-gaps-ui\\.spec\\.ts$"],
      ["product-gaps-ui-invites", "product-gaps-ui-invites\\.spec\\.ts$"],
    ] : product ? [
      // Phase 10A product-quality gate HC-QA-052..069 (failing-before
      // regressions + adjacent invariants), one file per fresh backend so
      // each batch stays within the real 10-login password limiter.
      ["product-vendor-signup", "product-vendor-signup\\.spec\\.ts$"],
      ["product-circles-a", "product-circles-a\\.spec\\.ts$"],
      ["product-circles-b", "product-circles-b\\.spec\\.ts$"],
      ["product-circles-c", "product-circles-c\\.spec\\.ts$"],
      ["product-host", "product-host\\.spec\\.ts$"],
      ["product-vendor", "product-vendor\\.spec\\.ts$"],
      ["product-states", "product-states\\.spec\\.ts$"],
      ["product-a11y-a", "product-a11y-a\\.spec\\.ts$"],
      ["product-a11y-b", "product-a11y-b\\.spec\\.ts$"],
      ["product-a11y-c", "product-a11y-c\\.spec\\.ts$"],
      ["product-a11y-d", "product-a11y-d\\.spec\\.ts$"],
      ["product-a11y-e", "product-a11y-e\\.spec\\.ts$"],
      ["product-p12-a", "product-p12-a\\.spec\\.ts$"],
      ["product-p12-b", "product-p12-b\\.spec\\.ts$"],
      ["product-deploy", "product-deploy\\.spec\\.ts$"],
      ["product-gaps-api", "product-gaps-api\\.spec\\.ts$"],
      ["product-gaps-circle", "product-gaps-circle\\.spec\\.ts$"],
      ["product-gaps-ui", "product-gaps-ui\\.spec\\.ts$"],
      ["product-gaps-ui-invites", "product-gaps-ui-invites\\.spec\\.ts$"],
    ] : stripeMode ? [
      ["stripe-preflight", "stripe-preflight\\.spec\\.ts$"],
      ["stripe-webhook", "stripe-webhook\\.spec\\.ts$"],
      ["stripe-checkout", "stripe-checkout\\.spec\\.ts$"],
      ["stripe-payment", "stripe-payment\\.spec\\.ts$"],
      ["stripe-refund", "stripe-refund\\.spec\\.ts$"],
      ["stripe-refund-external", "stripe-refund-external\\.spec\\.ts$"],
      ["stripe-selfcancel", "stripe-selfcancel\\.spec\\.ts$"],
      ["stripe-browser", "stripe-browser\\.spec\\.ts$"],
      ["stripe-findings", "stripe-findings\\.spec\\.ts$"],
    ] : booking ? [
      ["booking-centre", "booking-centre\\.spec\\.ts$"],
      ["booking-club", "booking-club\\.spec\\.ts$"],
      ["booking-program", "booking-program\\.spec\\.ts$"],
      ["booking-experience", "booking-experience\\.spec\\.ts$"],
      ["booking-activity", "booking-activity\\.spec\\.ts$"],
      ["booking-ui", "booking-ui\\.spec\\.ts$"],
      // Provider-independent paid state machine (QA provider seam enabled for this batch only).
      ["booking-provider", "booking-provider\\.spec\\.ts$"],
      // Phase 8 remediation scenarios (extended beyond the preserved regressions).
      ["booking-remediation", "booking-remediation\\.spec\\.ts$"],
      ["booking-remediation-cancel-booking", "booking-remediation-cancel\\.spec\\.ts$"],
      ["booking-remediation-cancel-registration", "booking-remediation-cancel\\.spec\\.ts$"],
      // Finding gate HC-QA-034..047, split to stay within the real 10-login limiter.
      ["booking-findings-a", "booking-findings-a\\.spec\\.ts$"],
      ["booking-findings-b", "booking-findings-b\\.spec\\.ts$"],
      ["booking-findings-c", "booking-findings-c\\.spec\\.ts$"],
    ] : lifecycle ? [
      ["lifecycle-activity-publish", "lifecycle-activity-publish\\.spec\\.ts$"],
      ["lifecycle-activity-participation", "lifecycle-activity-participation\\.spec\\.ts$"],
      ["lifecycle-activity-access", "lifecycle-activity-access\\.spec\\.ts$"],
      ["lifecycle-activity-states", "lifecycle-activity-states\\.spec\\.ts$"],
      ["lifecycle-circle-membership", "lifecycle-circle-membership\\.spec\\.ts$"],
      ["lifecycle-circle-planning", "lifecycle-circle-planning\\.spec\\.ts$"],
      ["lifecycle-notifications", "lifecycle-notifications\\.spec\\.ts$"],
      ["lifecycle-ui-desktop", "lifecycle-ui-desktop\\.spec\\.ts$"],
      ["lifecycle-ui-responsive", "lifecycle-ui-responsive\\.spec\\.ts$"],
      // HC-QA-001 — mobile bottom chrome vs. consent banner and bottom surfaces.
      ["lifecycle-ui-bottom-chrome", "lifecycle-ui-bottom-chrome\\.spec\\.ts$"],
      // Phase 7 finding gate HC-QA-022..033 (failing-before regressions + invariants),
      // split so every fresh backend stays within the real 10-login limiter.
      ["lifecycle-findings-chat", "lifecycle-findings-chat\\.spec\\.ts$"],
      ["lifecycle-findings-visibility", "lifecycle-findings-visibility\\.spec\\.ts$"],
      ["lifecycle-findings-polls-states", "lifecycle-findings-polls-states\\.spec\\.ts$"],
      ["lifecycle-findings-waitlist", "lifecycle-findings-waitlist\\.spec\\.ts$"],
      ["lifecycle-findings-waitlist-invariant", "lifecycle-findings-waitlist-invariant\\.spec\\.ts$"],
      ["lifecycle-findings-leave-cancel", "lifecycle-findings-leave-cancel\\.spec\\.ts$"],
      ["lifecycle-findings-cancel-ordering", "lifecycle-findings-cancel-ordering\\.spec\\.ts$"],
      ["lifecycle-findings-ui", "lifecycle-findings-ui\\.spec\\.ts$"],
      ["lifecycle-findings-circles", "lifecycle-findings-circles\\.spec\\.ts$"],
    ] : gate ? [
      ["account-link-race-closure", "account-link-race-closure\\.spec\\.ts$"],
      ["account-link-closure", "account-link-closure\\.spec\\.ts$"],
      ["chat-closure", "chat-closure\\.spec\\.ts$"],
      ["revocation-closure", "revocation-closure\\.spec\\.ts$"],
      ["activity-invitation-closure", "activity-invitation-closure\\.spec\\.ts$"],
      // Same split as qa:auth: one combined batch would exhaust the real limiter.
      ["hc-qa-002-core", "passwordless-security\\.spec\\.ts$"],
      ["hc-qa-002-collisions", "signup-collisions\\.spec\\.ts$"],
      ["hc-qa-002-flows", "signup-flows\\.spec\\.ts$"],
      ["hc-qa-002-recovery", "signup-recovery\\.spec\\.ts$"],
      ["hc-qa-003", "authorization-recovery\\.spec\\.ts$"],
      ["hc-qa-004", "authorization-logging\\.spec\\.ts$"],
      ["hc-qa-005", "authorization-leakage\\.spec\\.ts$"],
      ["hc-qa-006", "invitation-disclosure\\.spec\\.ts$"],
      ["hc-qa-007", "invitation-binding\\.spec\\.ts$"],
      ["hc-qa-008", "stage-b-attendance\\.spec\\.ts$"],
      ["hc-qa-009", "attendance-relations\\.spec\\.ts$"],
      // HC-QA-010..015 (014 = Model A decision) are unchanged regressions.
      ["hc-qa-010-015", "stage-b-findings\\.spec\\.ts$"],
      ["stage-b-open", "stage-b-open\\.spec\\.ts$"],
      ["join-visibility", "join-visibility\\.spec\\.ts$"],
    ] : authorization ? [
      ["account-link-race-closure", "account-link-race-closure\\.spec\\.ts$"],
      ["account-link-closure", "account-link-closure\\.spec\\.ts$"],
      ["chat-closure", "chat-closure\\.spec\\.ts$"],
      ["revocation-closure", "revocation-closure\\.spec\\.ts$"],
      ["activity-invitation-closure", "activity-invitation-closure\\.spec\\.ts$"],
      ["join-visibility", "join-visibility\\.spec\\.ts$"],
      ["stage-b-attendance", "stage-b-attendance\\.spec\\.ts$"],
      ["attendance-relations", "attendance-relations\\.spec\\.ts$"],
      ["invitation-disclosure", "invitation-disclosure\\.spec\\.ts$"],
      ["invitation-hardening", "invitation-hardening\\.spec\\.ts$"],
      ["invitation-binding", "invitation-binding\\.spec\\.ts$"],
      ["invitation-consumption", "invitation-consumption\\.spec\\.ts$"],
      ["invitation-states", "invitation-states\\.spec\\.ts$"],
      ["invitation-history", "invitation-history\\.spec\\.ts$"],
      ["boundaries", "authorization-boundaries\\.spec\\.ts$"],
      ["ownership", "authorization-ownership\\.spec\\.ts$"],
      ["personal", "authorization-personal\\.spec\\.ts$"],
      ["staff", "authorization-staff\\.spec\\.ts$"],
      ["leakage", "authorization-leakage\\.spec\\.ts$"],
      ["visibility-adjacent", "visibility-adjacent\\.spec\\.ts$"],
      ["logging-audit", "authorization-logging\\.spec\\.ts$"],
      ["logging-adjacent", "logging-adjacent\\.spec\\.ts$"],
      ["recovery-audit", "authorization-recovery\\.spec\\.ts$"],
      ["recovery-adjacent", "recovery-adjacent\\.spec\\.ts$"],
      // Phase 6B Stage B completion. One batch per file keeps each fresh
      // backend within the real 10-login password limiter.
      ["stage-b-vendor", "stage-b-vendor\\.spec\\.ts$"],
      ["stage-b-refund", "stage-b-refund\\.spec\\.ts$"],
      ["stage-b-org", "stage-b-org\\.spec\\.ts$"],
      ["stage-b-host", "stage-b-host\\.spec\\.ts$"],
      ["stage-b-circles", "stage-b-circles\\.spec\\.ts$"],
      ["stage-b-aggregation", "stage-b-aggregation\\.spec\\.ts$"],
      ["stage-b-admin", "stage-b-admin\\.spec\\.ts$"],
      ["stage-b-booking", "stage-b-booking\\.spec\\.ts$"],
      ["stage-b-personal", "stage-b-personal\\.spec\\.ts$"],
      ["stage-b-errors", "stage-b-errors\\.spec\\.ts$"],
      ["stage-b-media", "stage-b-media\\.spec\\.ts$"],
      // Stage B remediation: canonical visibility policy coverage.
      ["stage-b-visibility", "stage-b-visibility\\.spec\\.ts$"],
      ["stage-b-visibility-2", "stage-b-visibility-2\\.spec\\.ts$"],
      // Preserved findings remain unchanged after their scoped remediations.
      ["stage-b-findings", "stage-b-findings\\.spec\\.ts$"],
      // Original HC-QA-016 regression remains unchanged after remediation.
      ["stage-b-open", "stage-b-open\\.spec\\.ts$"],
    ] : [
      ["core", "(auth|passwordless-security)\\.spec\\.ts$"],
      ["collisions", "signup-collisions\\.spec\\.ts$"],
      ["flows", "signup-flows\\.spec\\.ts$"],
      ["recovery", "signup-recovery\\.spec\\.ts$"],
    ];
    for (const [batch, files] of batches) {
      const current = await connectedPreflight();
      await current.connection.end();
      if (current.manifest.runId !== checked.manifest.runId) throw new Error("QA SAFETY ABORT: Run changed between auth batches.");
      console.log(`Real auth batch: ${batch}`);
      const code = await new Promise<number>((resolve, reject) => {
        const child = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/integration/playwright.config.ts", ...(args.length ? ["--pass-with-no-tests"] : []), files, ...args], {
          cwd: repositoryRoot, env: { ...childEnvironment(current.env, current.manifest), QA_AUTH_BATCH: batch, QA_BROWSER: qaBrowser, ...(prodBuild ? { QA_PROD_BUILD: "1" } : {}), ...(batch === "booking-provider" ? { QA_PAYMENT_PROVIDER_STUB: "1" } : {}), ...stripeEnv }, stdio: "inherit",
        });
        child.once("error", reject);
        child.once("exit", (status) => resolve(status ?? 1));
      });
      if (code !== 0) { process.exitCode = code; if (!(product || browsers) || process.env.QA_PRODUCT_CONTINUE !== "1") break; }
    }
  } finally { release(); }
}
main().catch((error) => {
  // Only our own fixed QA STRIPE messages are surfaced (they never contain values).
  const message = error instanceof Error && /^QA STRIPE (NOT CONFIGURED|INVALID)|^QA SAFETY ABORT: stripe-test/.test(error.message) ? error.message : "QA SAFETY ABORT: Real authentication runner refused unsafe/unavailable environment.";
  console.error(message); process.exitCode = 1;
});
