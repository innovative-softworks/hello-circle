#!/usr/bin/env node
// Design-token regression guard (post-audit hardening pass) — NOT a general
// "no magic numbers" linter. theme.ts's own radius scale (control:10,
// card:16, pill:999) already exists and is now used in ui.tsx/Home.tsx; this
// only catches a *new* raw literal reintroducing one of those three exact
// values instead of the token that already covers it. Most of the app's
// other borderRadius values (12, 14, 8, 20, …) genuinely have no token yet —
// flagging those too would fail against the entire pre-existing codebase and
// be useless as a "did I regress" check. Migrating more files/values is a
// separate, incremental follow-up (see CLAUDE.md's design-system note).
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const TOKEN_VALUES = { 10: "radius.control", 16: "radius.card", 999: "radius.pill" };
const EXCLUDE = ["src/theme.ts"];
const root = new URL("..", import.meta.url);

const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { cwd: root, encoding: "utf-8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !EXCLUDE.includes(f))
  // A file deleted from disk but not yet `git rm`'d is normal transient repo
  // state (e.g. mid-refactor), not something this check should crash on.
  .filter((f) => existsSync(new URL(f, root)));

let failures = 0;
for (const file of files) {
  const path = new URL(`../${file}`, import.meta.url);
  const lines = readFileSync(path, "utf-8").split("\n");
  lines.forEach((line, i) => {
    for (const [value, token] of Object.entries(TOKEN_VALUES)) {
      const re = new RegExp(`borderRadius:\\s*${value}\\b(?!\\.)`);
      if (re.test(line)) {
        console.error(`${file}:${i + 1}: raw borderRadius: ${value} — use ${token} from theme.ts instead\n  ${line.trim()}`);
        failures++;
      }
    }
  });
}

if (failures > 0) {
  // As of the post-audit hardening pass that added this script: theme.ts,
  // ui.tsx, Home.tsx, Circles.tsx, and ClubDetail.tsx are migrated (0
  // failures); ~150 more exact-match sites remain across the rest of the
  // app — a real, tracked backlog, not something this pass claims to have
  // closed. Migrate incrementally, file by file (see CLAUDE.md), verifying
  // each visually before moving to the next — never in one big pass.
  console.error(`\n${failures} raw borderRadius literal(s) found that already have a theme.ts token — see above.`);
  process.exit(1);
}
console.log("lint:tokens — no regressions found.");
