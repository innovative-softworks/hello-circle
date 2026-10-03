import { spawnSync } from "node:child_process";
import { test, expect } from "../fixtures";
import { childEnvironment, loadRun, repositoryRoot } from "../runtime";

for (const mode of ["production", "test", "development"]) {
  for (const transport of ["absent", "success", "failure"]) {
    test(`LOGGING-ADJACENT: ${mode} with ${transport} transport never emits secrets`, async () => {
      const { env, manifest } = loadRun();
      const script = `
        const logs = [];
        for (const key of ['log','warn','error','info']) console[key] = (...args) => logs.push(args.join(' '));
        const canary = 'qa-noncredential-canary';
        let sends = 0;
        const nodemailer = (await import('nodemailer')).default;
        nodemailer.createTransport = () => ({ sendMail: async () => {
          sends++;
          if (${JSON.stringify(transport)} === 'failure') throw new Error('provider echoed secret=' + canary);
        } });
        const { sendMail } = await import('./server/src/email.ts');
        await sendMail({to: canary + '@example.test', subject: canary, text: 'reset?token=' + canary, cta: { label: 'Reset', url: 'http://127.0.0.1/reset?token=' + canary }});
        process.stdout.write(JSON.stringify({ leaked: logs.some(line => line.includes(canary)), sends }));
      `;
      const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        cwd: repositoryRoot, env: { ...childEnvironment(env, manifest), NODE_ENV: mode,
          ...(mode === "test" ? { VITEST: "true" } : {}),
          ...(transport === "absent" ? {} : { SMTP_HOST: "invalid.example.test", SMTP_USER: "qa", SMTP_PASS: "synthetic-not-a-credential" }),
        }, encoding: "utf8",
      });
      expect(result.status).toBe(0);
      const actual = JSON.parse(result.stdout);
      expect(actual.leaked).toBe(false);
      expect(actual.sends).toBe(transport === "absent" || mode === "test" ? 0 : 1);
    });
  }
}
