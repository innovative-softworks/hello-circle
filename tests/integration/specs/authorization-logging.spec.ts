import { spawnSync } from "node:child_process";
import { test, expect } from "../fixtures";
import { childEnvironment, loadRun, repositoryRoot } from "../runtime";
import { evidence } from "../authorization-fixture";

test("HC-QA-004: missing SMTP must not log secret-bearing recovery links", async () => {
  const { env, manifest } = loadRun();
  const outcomes: boolean[] = [];
  for (const mode of ["test", "production"]) {
    // Import ONLY the real email module and its Stripe-config dependency in a
    // fresh process. No dotenv, DB imports, backend startup or network calls.
    // Synthetic canary is not a valid token and never printed, even on failure.
    const script = `
      const lines = [];
      console.log = (...parts) => lines.push(parts.join(' '));
      const { sendMail } = await import('./server/src/email.ts');
      const canary = 'synthetic-noncredential-qa-canary';
      await sendMail({ to: 'qa@example.test', subject: 'QA recovery audit', text: 'http://127.0.0.1:4178/reset-password?token=' + canary });
      process.stdout.write(JSON.stringify({ leaked: lines.some(line => line.includes(canary)) }));
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: repositoryRoot, env: { ...childEnvironment(env, manifest), NODE_ENV: mode }, encoding: "utf8",
    });
    expect(result.status, "Isolated email-only audit process completed").toBe(0);
    outcomes.push(JSON.parse(result.stdout).leaked);
  }
  await evidence("hc-qa-004", { testModeLeaksSyntheticLink: outcomes[0], productionModeLeaksSyntheticLink: outcomes[1], realCredentialsUsed: false, networkUsed: false });
  expect(outcomes.some(Boolean), "Email fallback must not disclose bearer links in logs").toBe(false);
});
