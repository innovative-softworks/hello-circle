import path from "node:path";

export const authQaPersonas = ["QA_USER", "QA_USER_B", "QA_HOST", "QA_HOST_B", "QA_VENDOR", "QA_VENDOR_B", "QA_ADMIN"] as const;

/** Offline policy ONLY. No DB imports, network calls, process launches or mutations. */
export function authIntegrationConfigIssues(env: Record<string, string | undefined>, repositoryRoot: string): string[] {
  const issues: string[] = [];
  const requireExact = (key: string, expected: string) => {
    if (env[key] !== expected) issues.push(`${key} must match the documented local auth QA profile.`);
  };
  const requirePresent = (key: string) => {
    if (!env[key]?.trim()) issues.push(`${key} must be supplied explicitly.`);
  };
  requireExact("NODE_ENV", "test");
  requireExact("QA_E2E_ENABLED", "true");
  requireExact("QA_PROFILE", "auth");
  requireExact("E2E_ENVIRONMENT", "local");
  requireExact("E2E_BASE_URL", "http://127.0.0.1:4178");
  requireExact("E2E_API_URL", "http://127.0.0.1:4311");
  requireExact("CLIENT_URL", "http://127.0.0.1:4178");
  requireExact("PUBLIC_ORIGINS", "http://127.0.0.1:4178");
  requireExact("PORT", "4311");
  requireExact("DB_HOST", "127.0.0.1");
  requireExact("DB_PORT", "13306");
  requireExact("DB_USER", "hello_circle_qa");
  requirePresent("DB_PASSWORD");
  const runId = env.QA_RUN_ID;
  if (!runId || !/^qa_[a-z0-9]{8,24}$/.test(runId)) {
    issues.push("QA_RUN_ID must be qa_ followed by 8–24 lowercase letters/digits.");
  } else {
    requireExact("DB_NAME", `hello_circle_e2e_${runId}`);
    // Actual realpath/mount identity needs a future runtime check; lexical check alone is not isolation.
    const expectedDirectory = path.join(path.resolve(repositoryRoot), ".qa-data", runId);
    if (env.DATA_DIR !== expectedDirectory) issues.push("DATA_DIR must be the exact absolute .qa-data/<QA_RUN_ID> directory in this repository.");
  }
  requireExact("MEDIA_PROVIDER", "local");
  requireExact("CLOUDINARY_UPLOADS_ENABLED", "false");
  requireExact("MEDIA_LOCAL_PROCESSING_ENABLED", "false");
  requireExact("VITE_MAPBOX_ENABLED", "false");
  requireExact("VITE_LAUNCH_MODE", "public");
  requireExact("GEOCODER_BASE_URL", "http://127.0.0.1:4312");

  // The auth-only profile has no permitted external-service credentials, even test Stripe keys.
  for (const [key, value] of Object.entries(env)) {
    if (!value?.trim()) continue;
    if (/^(STRIPE_|SMTP_|R2_|FIREBASE_|VITE_FIREBASE_|AWS_)/.test(key)
      || ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "CLOUDINARY_URL", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "VITE_CLOUDINARY_CLOUD_NAME", "VITE_MEDIA_PUBLIC_DOMAIN", "VITE_MAPBOX_TOKEN", "PUBLIC_ORIGIN", "DOTENV_CONFIG_PATH", "DOTENV_CONFIG_OVERRIDE", "VITEST"].includes(key)) {
      issues.push(`${key} must be absent for auth-only QA; implicit service/config inheritance is not allowed.`);
    }
  }

  const seenEmails = new Set<string>();
  for (const persona of authQaPersonas) {
    const email = env[`${persona}_EMAIL`]?.trim().toLowerCase();
    if (!email || !/^[a-z0-9][a-z0-9._+-]*@example\.test$/.test(email)) {
      issues.push(`${persona}_EMAIL must be a synthetic address at example.test.`);
    } else if (seenEmails.has(email)) {
      issues.push(`${persona}_EMAIL must be distinct from all other personas.`);
    } else seenEmails.add(email);
    if ((env[`${persona}_PASSWORD`]?.length ?? 0) < 12) issues.push(`${persona}_PASSWORD must be supplied (at least 12 characters).`);
  }
  if (!env.HELLO_CIRCLE_ADMIN_EMAIL || env.HELLO_CIRCLE_ADMIN_EMAIL !== env.QA_ADMIN_EMAIL
    || !env.HELLO_CIRCLE_ADMIN_PASSWORD || env.HELLO_CIRCLE_ADMIN_PASSWORD !== env.QA_ADMIN_PASSWORD) {
    issues.push("HELLO_CIRCLE_ADMIN_EMAIL/PASSWORD must match QA_ADMIN inputs to prevent default-admin seeding.");
  }
  return issues;
}

export function authIntegrationPreflight(env: Record<string, string | undefined>, repositoryRoot: string): { exitCode: 1 | 2; message: string } {
  const issues = authIntegrationConfigIssues(env, repositoryRoot);
  if (issues.length) return {
    exitCode: 1,
    message: `QA ABORTED — unsafe or incomplete integration configuration. No services contacted.\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
  };
  return {
    exitCode: 2,
    message: "QA BLOCKED — offline configuration checks passed, but database grants, runtime identity, mounts and network isolation are not verified. No services contacted; mutation execution remains disabled.",
  };
}

/** Phase 9 — the ONLY external-provider credential the QA harness ever accepts:
 * a Stripe TEST-mode secret key, read from a separate private file
 * (`~/.config/hellocircle-qa/stripe-test.json`, dir 0700 / file 0600 — never
 * inside the repo or the DB-mounted secrets dir) and only for the opt-in
 * `qa:stripe` runner. Every other profile keeps refusing all STRIPE_* keys.
 * Messages never contain the values. */
export function stripeTestProfileIssues(cfg: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const key of Object.keys(cfg)) if (key !== "STRIPE_SECRET_KEY") issues.push(`${key} is not permitted in the Stripe test profile.`);
  const secret = cfg.STRIPE_SECRET_KEY;
  if (typeof secret !== "string" || !/^(sk|rk)_test_[A-Za-z0-9]{16,}$/.test(secret)) issues.push("STRIPE_SECRET_KEY must be a Stripe TEST-mode secret key.");
  if (typeof secret === "string" && /_live_/.test(secret)) issues.push("Live-mode Stripe credentials are refused.");
  return issues;
}

/** Locally generated per-run webhook signing secret shape (never a Dashboard secret). */
export const QA_WEBHOOK_SECRET_PATTERN = /^whsec_qa_[a-f0-9]{64}$/;

/** Browser hosts Stripe-hosted Checkout needs in the Stripe test profile only. */
export function isStripeBrowserHost(hostname: string): boolean {
  return /(^|\.)(stripe\.com|stripe\.network|stripecdn\.com)$/.test(hostname);
}

