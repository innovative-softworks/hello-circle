import { afterAll, describe, expect, it } from "vitest";
import { db, initSchema, setSetting } from "../db/index.js";
import { autoRefundSwitchOn } from "./paymentReview.js";

// D-10 containment: once finance switches automatic refunds off, a restart
// (initSchema = every boot's migration) must never turn them back on. The
// catalog default (on) applies only while no value has ever been stored.

const KEY = "commerce.auto_refund_unfulfillable";

afterAll(async () => {
  await db.prepare("DELETE FROM app_settings WHERE `key` = ?").run(KEY);
});

describe("automatic-refund switch across restarts", () => {
  it("stays off after the startup migration runs again", async () => {
    await setSetting(KEY, "false");
    await initSchema();
    const row = (await db.prepare("SELECT value FROM app_settings WHERE `key` = ?").get(KEY)) as { value: string };
    expect(row.value).toBe("false");
    expect(await autoRefundSwitchOn()).toBe(false);
  });
});
