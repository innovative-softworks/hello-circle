import { cert, getApps, initializeApp, type App } from "firebase-admin/app";

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
// Env vars can't hold a real newline — the downloaded service-account JSON's
// private_key has literal "\n" escapes that survive a naive `.env` copy-paste,
// so they're un-escaped back into real newlines here.
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

// Shared Firebase Admin app, used by both push.ts (FCM) and googleAuth.ts
// (verifying a client's Google sign-in ID token) — same "unconfigured = log
// and skip, never throw" contract as email.ts's nodemailer transporter.
let app: App | null = null;
if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
  app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY,
      }),
    });
} else {
  console.log(
    "[firebase] not configured (set FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY in server/.env) — push notifications will be logged instead of sent, and Google sign-in will respond 503"
  );
}

export function getFirebaseApp(): App | null {
  return app;
}
