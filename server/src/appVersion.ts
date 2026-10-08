import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// The release number shown to testers/admins: the root package.json
// "version" (bumped on each release, see RELEASES.md) plus the short git
// commit it was built from. APP_COMMIT overrides the commit for deploys that
// aren't git checkouts (production's /opt/hello-circle is an archive copy).
// Resolved once at startup; both parts degrade to empty rather than throw.

const rootPkg = new URL("../../package.json", import.meta.url);

function readVersion(): string {
  try {
    return String(JSON.parse(fs.readFileSync(rootPkg, "utf8")).version ?? "");
  } catch {
    return "";
  }
}

function readCommit(): string {
  if (process.env.APP_COMMIT) return process.env.APP_COMMIT.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch {
    return "";
  }
}

export const APP_VERSION = readVersion();
export const APP_COMMIT = readCommit();

/** e.g. "v0.9.0 · build 2ff445c" (either part omitted when unknown). */
export function versionLabel(): string {
  return [APP_VERSION && `v${APP_VERSION}`, APP_COMMIT && `build ${APP_COMMIT}`].filter(Boolean).join(" · ");
}
