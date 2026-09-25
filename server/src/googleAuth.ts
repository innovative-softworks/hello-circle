import { getAuth } from "firebase-admin/auth";
import { getFirebaseApp } from "./firebaseApp.js";

export interface VerifiedGoogleIdentity {
  uid: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/** Thrown when FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY aren't set —
 * callers turn this into a 503, same posture as Stripe/media routes when
 * their own provider isn't configured. */
export class GoogleAuthNotConfigured extends Error {}

/** Verifies a Firebase ID token minted by the client's Google sign-in and
 * returns the identity it proves — never trust a client-supplied email/uid
 * directly (see routes/guestAuth.ts and routes/auth.ts, the only callers).
 * Firebase issues the same token shape for every provider it supports, and
 * this app only ever wires up Google, so a token from any other provider
 * (or a malformed/expired/tampered one) is rejected the same way as a
 * verification failure. Google-issued emails are always verified, but the
 * `email_verified` claim is still checked explicitly rather than assumed,
 * since it's what `verifyIdToken` actually attests to. */
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleIdentity | null> {
  const app = getFirebaseApp();
  if (!app) throw new GoogleAuthNotConfigured();

  let decoded;
  try {
    decoded = await getAuth(app).verifyIdToken(idToken);
  } catch (e) {
    console.error("[googleAuth] verifyIdToken rejected the token:", e instanceof Error ? e.message : e);
    return null;
  }
  if (decoded.firebase?.sign_in_provider !== "google.com") return null;
  if (!decoded.email || decoded.email_verified !== true) return null;

  return {
    uid: decoded.uid,
    email: decoded.email.toLowerCase().trim(),
    name: typeof decoded.name === "string" ? decoded.name : null,
    picture: typeof decoded.picture === "string" ? decoded.picture : null,
  };
}
