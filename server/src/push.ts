import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { db } from "./db/index.js";

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
// Env vars can't hold a real newline — the downloaded service-account JSON's
// private_key has literal "\n" escapes that survive a naive `.env` copy-paste,
// so they're un-escaped back into real newlines here.
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

// Same "unconfigured = log and skip, never throw" contract as email.ts's
// nodemailer transporter — a booking/waitlist/game notification must never
// fail because push isn't set up (or a token is stale/revoked).
let app: App | null = null;
if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
  app = getApps()[0] ?? initializeApp({
    credential: cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY,
    }),
  });
} else {
  console.log(
    "[push] Firebase not configured (set FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY in server/.env) — push notifications will be logged, not sent"
  );
}

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
