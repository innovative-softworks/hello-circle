import { getMessaging } from "firebase-admin/messaging";
import { db } from "./db/index.js";
import { getFirebaseApp } from "./firebaseApp.js";

// Same "unconfigured = log and skip, never throw" contract as email.ts's
// nodemailer transporter — a booking/waitlist/game notification must never
// fail because push isn't set up (or a token is stale/revoked). App init
// itself now lives in firebaseApp.ts, shared with googleAuth.ts.
const app = getFirebaseApp();

export interface PushMessage {
  title: string;
  body: string;
  /** Deep-link path (e.g. "/bookings?ref=..."), matched by the client's
   * setupAppUrlListener/notification-tap handling — kept as a plain path,
   * not a full URL, same shape native.ts's own listener expects. */
  path?: string;
}

/** Sends to every device registered for this resident (device_push_tokens —
 * see push-token routes in routes/residents.ts). Never throws: a failed or
 * unconfigured send must not break whatever triggered the notification.
 * Prunes tokens FCM reports as unregistered/invalid, so a resident who
 * uninstalled the app or revoked notifications doesn't accumulate permanent
 * dead sends. */
export async function sendPush(residentId: string, msg: PushMessage): Promise<void> {
  const rows = (await db.prepare(`SELECT token FROM device_push_tokens WHERE resident_id = ?`).all(residentId)) as { token: string }[];
  if (rows.length === 0) return;

  if (!app) {
    console.log(`[push:dev] resident=${residentId} devices=${rows.length} title="${msg.title}"\n${msg.body}\n`);
    return;
  }

  const staleTokens: string[] = [];
  await Promise.all(
    rows.map(async ({ token }) => {
      try {
        await getMessaging(app!).send({
          token,
          notification: { title: msg.title, body: msg.body },
          data: msg.path ? { path: msg.path } : undefined,
        });
      } catch (e) {
        const code = (e as { errorInfo?: { code?: string } })?.errorInfo?.code;
        if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
          staleTokens.push(token);
        } else {
          console.error(`[push] send failed for resident ${residentId}:`, e instanceof Error ? e.message : e);
        }
      }
    })
  );

  if (staleTokens.length > 0) {
    await db.prepare(`DELETE FROM device_push_tokens WHERE token IN (${staleTokens.map(() => "?").join(",")})`).run(...staleTokens);
  }
}
