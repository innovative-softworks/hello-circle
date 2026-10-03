// HC-QA-092 — isolated server unit-test profile (the release-gate way to run
// the server Vitest suite). `npm test --workspace server` runs this.
//
// It never reads server/.env and never touches hello_circle / hello_circle_dev:
//   1. starts a disposable MySQL 8.0 container (tmpfs storage, loopback-only
//      random port, random root password passed via the child environment),
//   2. creates hello_circle_test_<runid> plus a user granted ONLY that
//      database, and an identity marker row carrying the run id,
//   3. applies the schema + the deterministic demo seed,
//   4. runs Vitest with a scrubbed environment: no provider credentials, an
//      empty dotenv file, NODE_ENV=test, and the profile markers that
//      vitest.setup.ts verifies (including the marker row) before any test,
//   5. removes the container — always, even on failure.
// Extra CLI args are passed through to Vitest (e.g. a test-file filter).
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Workspace dependencies may be hoisted to the repo root — resolve, don't assume.
const requireFromServer = createRequire(path.join(serverRoot, "package.json"));
const pkgDir = (name: string) => path.dirname(requireFromServer.resolve(`${name}/package.json`));
const tsxCli = path.join(pkgDir("tsx"), "dist/cli.mjs");
const vitestCli = path.join(pkgDir("vitest"), "vitest.mjs");
const docker = (args: string[], env?: NodeJS.ProcessEnv) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: env ?? process.env, timeout: 180_000 }).trim();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: serverRoot, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const runId = crypto.randomBytes(6).toString("hex");
  const dbName = `hello_circle_test_${runId}`;
  const rootPassword = crypto.randomBytes(24).toString("hex");
  const appPassword = crypto.randomBytes(24).toString("hex");
  const port = await freePort();
  const containerName = `hellocircle-server-test-${runId}`;
  const emptyEnv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hc-server-test-")), "empty.env");
  fs.writeFileSync(emptyEnv, "", { mode: 0o600 });

  let containerId = "";
  const cleanup = () => {
    if (containerId) { try { docker(["rm", "--force", containerId]); } catch { /* best effort */ } }
    try { fs.rmSync(path.dirname(emptyEnv), { recursive: true, force: true }); } catch { /* best effort */ }
  };
  process.once("SIGINT", () => { cleanup(); process.exit(130); });

  try {
    containerId = docker(
      ["run", "-d", "--rm", "--name", containerName, "--label", "ie.hellocircle.server-test=1",
        "--publish", `127.0.0.1:${port}:3306`, "--tmpfs", "/var/lib/mysql:rw,nosuid,size=1g",
        "--env", "MYSQL_ROOT_PASSWORD", "mysql:8.0"],
      { ...process.env, MYSQL_ROOT_PASSWORD: rootPassword }
    );
    const admin = (sql: string) =>
      execFileSync("docker", ["exec", "-i", "-e", "MYSQL_PWD", containerId, "mysql", "-uroot", "--batch", "--skip-column-names"], {
        input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, MYSQL_PWD: rootPassword },
      }).trim();
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      try { ready = admin("SELECT 1") === "1"; } catch { await new Promise((r) => setTimeout(r, 1000)); }
    }
    if (!ready) throw new Error("disposable MySQL did not become ready");
    // Wait for the real server (the entrypoint restarts mysqld once after init).
    for (let i = 0; i < 30; i++) {
      try { const s = net.connect(port, "127.0.0.1"); await new Promise<void>((ok, bad) => { s.once("connect", () => { s.end(); ok(); }); s.once("error", bad); }); break; }
      catch { await new Promise((r) => setTimeout(r, 1000)); }
    }
    admin(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'hc_server_test'@'%' IDENTIFIED BY '${appPassword}';
GRANT ALL PRIVILEGES ON \`${dbName.replaceAll("_", "\\_")}\`.* TO 'hc_server_test'@'%';
CREATE TABLE \`${dbName}\`.hc_server_test_identity (run_id VARCHAR(32) PRIMARY KEY);
INSERT INTO \`${dbName}\`.hc_server_test_identity VALUES ('${runId}');`);

    // Scrubbed environment: nothing inherited except what a process needs to run.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, TZ: "UTC",
      NODE_ENV: "test",
      DOTENV_CONFIG_PATH: emptyEnv,
      HC_SERVER_TEST_PROFILE: "isolated",
      HC_SERVER_TEST_RUN_ID: runId,
      DB_HOST: "127.0.0.1", DB_PORT: String(port), DB_USER: "hc_server_test", DB_PASSWORD: appPassword, DB_NAME: dbName,
      HELLO_CIRCLE_ADMIN_EMAIL: "server-test-admin@example.test",
      HELLO_CIRCLE_ADMIN_PASSWORD: crypto.randomBytes(18).toString("hex"),
      CLIENT_URL: "http://127.0.0.1:5173",
      DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "hc-server-test-data-")),
      MEDIA_PROVIDER: "local",
      GEOCODER_BASE_URL: "http://127.0.0.1:9", // discard port: geocoding never leaves the machine
    };
    console.log(`[server-test] disposable database ${dbName} on 127.0.0.1:${port} (run ${runId})`);
    const seeded = await run(process.execPath, [tsxCli, "src/scripts/testDbSeed.ts"], env);
    if (seeded !== 0) throw new Error("schema/seed step failed");
    const code = await run(process.execPath, [vitestCli, "run", ...process.argv.slice(2)], env);
    try { fs.rmSync(env.DATA_DIR!, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exitCode = code;
  } catch (e) {
    console.error(`[server-test] FAILED: ${e instanceof Error ? e.message : "unknown error"}`);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}

main();
