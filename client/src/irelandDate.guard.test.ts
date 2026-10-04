import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// HC-QA-077 / HC-QA-100 guard — calendar dates are derived only through
// irelandDate.ts. `someDate.toISOString().slice(0, 10)` reads the UTC day
// (wrong for Ireland between 00:00 and 01:00 in summer, and wrong for any
// local-midnight Date east of UTC), so it may not appear anywhere else.

const SRC = join(__dirname);
const FORBIDDEN = /toISOString\(\)\s*\.\s*(slice\(0,\s*10\)|substring\(0,\s*10\)|split\(["']T["']\)\[0\])/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("Ireland date guard", () => {
  it("no client source derives a calendar date from toISOString() outside irelandDate.ts", () => {
    const offenders = sourceFiles(SRC)
      .filter((p) => !p.endsWith("irelandDate.ts"))
      .flatMap((p) => readFileSync(p, "utf8").split("\n").map((line, i) => (FORBIDDEN.test(line) ? `${relative(SRC, p)}:${i + 1}` : null)).filter(Boolean));
    expect(offenders).toEqual([]);
  });
});
