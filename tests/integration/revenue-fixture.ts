import type { Page } from "@playwright/test";
import { expect } from "./fixtures";
import type { connectedPreflight } from "./runtime";

// Revenue & Connect Stage 5c — helpers for the Stage 3–5 browser journeys.
// Same isolation rules as every other real-environment batch: real
// React/Vite, real Express/MySQL in the isolated QA container, external
// origins aborted, the network-free payment-provider stub (no Stripe call is
// possible: the batch never receives a provider key), exact-ID cleanup.

type Connection = Awaited<ReturnType<typeof connectedPreflight>>["connection"];

/** Sets commerce switches in the QA database and waits out the backend's 5 s
 * settings cache. Returns a restore function (previous values, exact keys). */
export async function setSwitches(connection: Connection, values: Record<string, boolean>): Promise<() => Promise<void>> {
  const keys = Object.keys(values);
  const [before] = await connection.query<any[]>(`SELECT \`key\`, value FROM app_settings WHERE \`key\` IN (${keys.map(() => "?").join(",")})`, keys);
  for (const [key, on] of Object.entries(values)) {
    await connection.execute("INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, on ? "true" : "false"]);
  }
  await new Promise((r) => setTimeout(r, 5_500));
  return async () => {
    for (const key of keys) {
      const prior = before.find((b: { key: string }) => b.key === key);
      if (prior) await connection.execute("UPDATE app_settings SET value = ? WHERE `key` = ?", [prior.value, key]);
      else await connection.execute("DELETE FROM app_settings WHERE `key` = ?", [key]);
    }
  };
}

/** Temporarily publishes version 1 of a policy (as if it had passed the CMS
 * gates, which have their own server tests); restores it to draft after. */
export async function publishForTest(connection: Connection, docKey: string): Promise<() => Promise<void>> {
  const [[before]] = await connection.query<any[]>("SELECT status, published_body, content_hash, published_at FROM policy_versions WHERE doc_key = ? AND version = 1", [docKey]);
  await connection.execute("UPDATE policy_versions SET status = 'published', published_body = body, content_hash = REPEAT('a', 64), published_at = NOW() WHERE doc_key = ? AND version = 1", [docKey]);
  return async () => {
    await connection.execute("UPDATE policy_versions SET status = ?, published_body = ?, content_hash = ?, published_at = ? WHERE doc_key = ? AND version = 1", [before.status, before.published_body, before.content_hash, before.published_at, docKey]);
  };
}

/** The page has no horizontal overflow at the current viewport. */
export async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal scroll").toBe(true);
}

/** Stage 5f — saves a full-page screenshot as browser evidence for a UI state
 * (QA data directory, evidence/stage5f/<name>.png). No personal data: QA personas only. */
export async function shot(page: Page, name: string) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("bad screenshot name");
  const { connectedPreflight } = await import("./runtime");
  const { mkdirSync } = await import("node:fs");
  const path = await import("node:path");
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "stage5f");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}
