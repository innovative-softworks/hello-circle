import { isDeepStrictEqual } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { expect } from "@playwright/test";
import { env, personas } from "./fixtures";
import { connectedPreflight } from "./runtime";

export async function withActors(playwright: PlaywrightWorkerArgs["playwright"], names: string[], exercise: (fixture: {
  actors: Record<string, APIRequestContext>;
  connection: Awaited<ReturnType<typeof connectedPreflight>>["connection"];
  track: (table: string, column: string, id: string | number) => void;
  snapshot: (sql: string, values: (string | number)[]) => Promise<() => Promise<void>>;
}) => Promise<void>) {
  const checked = await connectedPreflight();
  const actors: Record<string, APIRequestContext> = {};
  const cleanup: { table: string; column: string; id: string | number }[] = [];
  try {
    for (const name of names) {
      const context = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
      actors[name] = context;
      if (name === "GUEST") continue;
      if (!personas[name]) throw new Error("Seed paired personas first");
      const resident = personas[name].role.startsWith("resident");
      const response = await context.post(resident ? "/api/guest/login" : "/api/auth/login", {
        data: { email: env[`${name}_EMAIL`], password: env[`${name}_PASSWORD`] },
      });
      expect(response.status(), "Real persona login").toBe(200);
      const identity = await (await context.get(resident ? "/api/residents/me" : "/api/auth/me")).json();
      expect((resident ? identity.resident : identity.user).id === personas[name].id).toBe(true);
    }
    await exercise({ actors, connection: checked.connection,
      track: (table, column, id) => {
        if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) throw new Error("Invalid cleanup scope");
        cleanup.push({ table, column, id });
      },
      snapshot: async (sql, values) => {
        if (!/^SELECT /i.test(sql)) throw new Error("Snapshot must be read-only");
        const [before] = await checked.connection.query(sql, values);
        return async () => {
          const [after] = await checked.connection.query(sql, values);
          expect(isDeepStrictEqual(before, after), "Denied request must preserve complete scoped database snapshot").toBe(true);
        };
      },
    });
  } finally {
    for (const [name, context] of Object.entries(actors)) {
      if (name !== "GUEST") await context.post(personas[name].role.startsWith("resident") ? "/api/guest/logout" : "/api/auth/logout");
      await context.dispose();
    }
    await checked.connection.end();
    const safe = await connectedPreflight();
    try {
      if (safe.manifest.runId !== checked.manifest.runId) throw new Error("QA SAFETY ABORT: Cleanup run mismatch");
      for (const { table, column, id } of cleanup.reverse()) {
        if (["games", "circles", "centres", "programs"].includes(table) && column === "id") {
          // Delete only telemetry explicitly bound to this test-created resource.
          await safe.connection.execute("DELETE FROM analytics_events WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.id')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.circleId')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.gameId')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.listingId')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.entityId')) = ?", [id, id, id, id, id]);
        }
        if (table === "circle_polls" && column === "circle_id") {
          // Phase 10A hygiene — poll children have no circle_id of their own.
          await safe.connection.execute("DELETE v FROM circle_poll_votes v JOIN circle_poll_options o ON o.id = v.option_id JOIN circle_polls p ON p.id = o.poll_id WHERE p.circle_id = ?", [id]);
          await safe.connection.execute("DELETE o FROM circle_poll_options o JOIN circle_polls p ON p.id = o.poll_id WHERE p.circle_id = ?", [id]);
        }
        await safe.connection.execute(`DELETE FROM ${table} WHERE ${column} = ?`, [id]);
      }
    } finally { await safe.connection.end(); }
  }
}

export async function evidence(name: string, facts: Record<string, boolean | number | string | number[]>) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid evidence name");
  const checked = await connectedPreflight();
  await checked.connection.end();
  const directory = path.join(checked.manifest.dataDir, "evidence");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Callers supply only explicit safe facts, never request/response/DB objects.
  writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(facts, null, 2), { mode: 0o600 });
}
