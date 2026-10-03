import { randomBytes } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { authIntegrationConfigIssues, authIntegrationPreflight, authQaPersonas, stripeTestProfileIssues, isStripeBrowserHost, QA_WEBHOOK_SECRET_PATTERN } from "./integration-safety";

const root = path.resolve(".");
function validConfig(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    NODE_ENV: "test", QA_E2E_ENABLED: "true", QA_PROFILE: "auth", QA_RUN_ID: "qa_unittest01",
    E2E_ENVIRONMENT: "local", E2E_BASE_URL: "http://127.0.0.1:4178", E2E_API_URL: "http://127.0.0.1:4311",
    CLIENT_URL: "http://127.0.0.1:4178", PUBLIC_ORIGINS: "http://127.0.0.1:4178", PORT: "4311",
    DB_HOST: "127.0.0.1", DB_PORT: "13306", DB_USER: "hello_circle_qa", DB_PASSWORD: randomBytes(24).toString("hex"),
    DB_NAME: "hello_circle_e2e_qa_unittest01", DATA_DIR: path.join(root, ".qa-data", "qa_unittest01"),
    MEDIA_PROVIDER: "local", CLOUDINARY_UPLOADS_ENABLED: "false", MEDIA_LOCAL_PROCESSING_ENABLED: "false",
    VITE_MAPBOX_ENABLED: "false", VITE_LAUNCH_MODE: "public", GEOCODER_BASE_URL: "http://127.0.0.1:4312",
  };
  for (const persona of authQaPersonas) {
    env[`${persona}_EMAIL`] = `${persona.toLowerCase()}@example.test`;
    env[`${persona}_PASSWORD`] = randomBytes(24).toString("hex");
  }
  env.HELLO_CIRCLE_ADMIN_EMAIL = env.QA_ADMIN_EMAIL;
  env.HELLO_CIRCLE_ADMIN_PASSWORD = env.QA_ADMIN_PASSWORD;
  return env;
}

describe("offline real-auth preflight", () => {
  it("valid configuration is still blocked until runtime isolation is independently verified", () => {
    const env = validConfig();
    expect(authIntegrationConfigIssues(env, root)).toEqual([]);
    expect(authIntegrationPreflight(env, root)).toMatchObject({ exitCode: 2 });
    expect(authIntegrationPreflight(env, root).message).toContain("QA BLOCKED");
  });
  it("rejects absent configuration without contacting any service", () => {
    expect(authIntegrationPreflight({}, root).exitCode).toBe(1);
  });
  it.each([
    ["NODE_ENV", "production"], ["NODE_ENV", "development"], ["QA_E2E_ENABLED", "false"], ["QA_PROFILE", "payments"],
    ["QA_RUN_ID", "../../other"], ["E2E_ENVIRONMENT", "staging"], ["E2E_BASE_URL", "https://hellocircle.ie"],
    ["E2E_API_URL", "http://127.0.0.1:3001"], ["CLIENT_URL", "https://hellocircle.ie"], ["PUBLIC_ORIGINS", "*"],
    ["PORT", "3001"], ["DB_HOST", "db.example.test"], ["DB_PORT", "3306"], ["DB_USER", "root"],
    ["DB_PASSWORD", ""], ["DB_NAME", "hello_circle"], ["DB_NAME", "hello_circle_dev"], ["DB_NAME", "hello_circle_e2e_qa_other001"],
    ["DATA_DIR", path.join(root, "server")], ["DATA_DIR", path.join(root, ".qa-data", "qa_other001")],
    ["MEDIA_PROVIDER", "r2"], ["CLOUDINARY_UPLOADS_ENABLED", "true"], ["VITE_MAPBOX_ENABLED", "true"],
    ["GEOCODER_BASE_URL", "https://nominatim.openstreetmap.org"], ["QA_USER_EMAIL", "customer@example.com"],
    ["QA_USER_PASSWORD", ""], ["HELLO_CIRCLE_ADMIN_PASSWORD", ""],
  ])("rejects unsafe %s configuration", (key, value) => {
    const result = authIntegrationPreflight({ ...validConfig(), [key]: value }, root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("QA ABORTED");
  });
  it.each([
    "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SMTP_HOST", "SMTP_PASS", "R2_BUCKET", "R2_SECRET_ACCESS_KEY",
    "CLOUDINARY_API_SECRET", "CLOUDINARY_URL", "FIREBASE_PRIVATE_KEY", "VITE_FIREBASE_API_KEY", "VITE_MAPBOX_TOKEN",
    "AWS_ACCESS_KEY_ID", "GOOGLE_APPLICATION_CREDENTIALS", "DOTENV_CONFIG_PATH", "VITEST",
  ])("rejects inherited external/config variable %s without echoing its value", (key) => {
    const value = randomBytes(24).toString("hex");
    const result = authIntegrationPreflight({ ...validConfig(), [key]: value }, root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain(key);
    expect(result.message).not.toContain(value);
  });
  it.each(["sk_test_", "sk_live_"])("rejects %s keys in the auth-only profile", (prefix) => {
    expect(authIntegrationPreflight({ ...validConfig(), STRIPE_SECRET_KEY: prefix + randomBytes(24).toString("hex") }, root).exitCode).toBe(1);
  });
  it("requires distinct persona identities, including case-insensitive duplicates", () => {
    const env = validConfig();
    env.QA_USER_B_EMAIL = env.QA_USER_EMAIL?.toUpperCase();
    expect(authIntegrationConfigIssues(env, root)).toContain("QA_USER_B_EMAIL must be distinct from all other personas.");
  });
  it("requires admin bootstrap to match the QA admin", () => {
    const env = validConfig();
    env.HELLO_CIRCLE_ADMIN_EMAIL = "unrelated@example.test";
    expect(authIntegrationConfigIssues(env, root).some((issue) => issue.startsWith("HELLO_CIRCLE_ADMIN"))).toBe(true);
  });
});

describe("Phase 9 Stripe TEST-mode profile", () => {
  const testKey = "sk_test_" + "a".repeat(24); // synthetic shape only, not a credential
  it("accepts only a test-mode secret key", () => {
    expect(stripeTestProfileIssues({ STRIPE_SECRET_KEY: testKey })).toEqual([]);
    expect(stripeTestProfileIssues({ STRIPE_SECRET_KEY: "rk_test_" + "b".repeat(24) })).toEqual([]);
  });
  it("refuses live-mode, publishable, malformed and missing keys", () => {
    for (const bad of ["sk_live_" + "a".repeat(24), "rk_live_" + "a".repeat(24), "pk_test_" + "a".repeat(24), "sk_test_short", "", undefined]) {
      expect(stripeTestProfileIssues({ STRIPE_SECRET_KEY: bad as any }).length).toBeGreaterThan(0);
    }
    expect(stripeTestProfileIssues({ STRIPE_SECRET_KEY: "sk_live_" + "a".repeat(24) }).join(" ")).toMatch(/Live-mode|TEST-mode/);
  });
  it("refuses any additional provider configuration (webhook secrets are minted per run, never supplied)", () => {
    expect(stripeTestProfileIssues({ STRIPE_SECRET_KEY: testKey, STRIPE_WEBHOOK_SECRET: "whsec_x" }).length).toBe(1);
  });
  it("issue messages never echo the key", () => {
    const secret = "sk_live_" + "z".repeat(30);
    expect(stripeTestProfileIssues({ STRIPE_SECRET_KEY: secret }).join(" ")).not.toContain(secret);
  });
  it("browser allowance is Stripe hosts only", () => {
    expect(isStripeBrowserHost("checkout.stripe.com")).toBe(true);
    expect(isStripeBrowserHost("js.stripe.com")).toBe(true);
    expect(isStripeBrowserHost("m.stripe.network")).toBe(true);
    for (const h of ["stripe.com.evil.test", "evilstripe.com", "api.example.test", "hellocircle.ie"]) expect(isStripeBrowserHost(h)).toBe(false);
  });
  it("per-run webhook secrets have the local QA shape", () => {
    expect(QA_WEBHOOK_SECRET_PATTERN.test("whsec_qa_" + "0".repeat(64))).toBe(true);
    expect(QA_WEBHOOK_SECRET_PATTERN.test("whsec_" + "0".repeat(32))).toBe(false);
  });
});
