import { initializeApp, type FirebaseApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, type Auth } from "firebase/auth";

// Firebase Web config (apiKey/authDomain/projectId/appId) is client-visible
// by design — it identifies the project, it doesn't authorize anything on
// its own (that's Firebase's Authorized Domains + this app's own server-
// side token verification in server/src/googleAuth.ts). See README.md for
// where to get these values and which VITE_FIREBASE_* vars to set.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Google sign-in is optional infrastructure — same "unconfigured = disabled,
// never crash the app" contract as Stripe/Cloudinary/Mapbox elsewhere here
// (see server/src/stripe.ts, media.ts, MapView's own token check). Every
// VITE_FIREBASE_* var must be set for the Google button to actually work;
// if any are missing, signInWithGoogle() below throws a typed error the UI
// turns into a "not available right now" message instead of a crash.
export const firebaseReady = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
if (firebaseReady) {
  app = initializeApp(config);
  auth = getAuth(app);
} else if (import.meta.env.DEV) {
  console.log("[firebase] not configured (set VITE_FIREBASE_API_KEY/AUTH_DOMAIN/PROJECT_ID/APP_ID) — Google sign-in will show as unavailable");
}

export function getFirebaseAuth(): Auth | null {
  return auth;
}

export const googleProvider = new GoogleAuthProvider();
// Always show Google's account chooser on click, even for someone with only
// one Google session in this browser — without this, Google may silently
// auto-select that single account instead of offering a choice, which reads
// as "it just logged me in" rather than a real "continue with Google"
// moment. This does NOT force repeated consent — Google still skips the
// permissions screen on a return visit once it's already been granted; this
// only ever controls whether the account picker itself shows.
googleProvider.setCustomParameters({ prompt: "select_account" });
