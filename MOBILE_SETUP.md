# Mobile app (Capacitor) — remaining setup

The 5-phase Capacitor migration (native shell, splash/status bar, magic-link deep linking,
in-app Stripe Checkout, native push) is code-complete and verified — see the plan history
for what was built. Everything below is **external account/credential setup only a human can
do** (developer accounts, key generation, GUI-only Xcode steps) — none of it can be scripted
from this repo. Each section names exactly which files currently hold a placeholder and what
to replace it with once the real value exists.

Nothing here blocks local development or the existing web app — every placeholder fails
closed (App/Universal Links don't verify, push silently no-ops) rather than breaking anything.

## 1. Decide the real bundle ID / package name

Every native project currently uses the placeholder `ie.hellocircle.app`, chosen to match the
`admin@hellocircle.ie` convention already in the codebase (see README.md, `server/.env.production`).
**If this isn't the real identifier you want to ship under, decide it now** — changing it later
means regenerating both native projects (`npx cap add ios`/`android` again), not just a find-replace.

Current placeholder appears in:
- `client/capacitor.config.ts` — `appId`
- `client/ios/App/App/App.entitlements` (implicitly, via the Xcode project's bundle identifier)
- `client/android/app/build.gradle` (implicitly, via `applicationId`)
- `server/src/index.ts` — the `apple-app-site-association` response's `appID`
- `server/src/index.ts` — the `assetlinks.json` response's `package_name`

## 2. Decide the real production domain

Every Universal/App Link and the AASA/assetlinks routes use the placeholder `hellocircle.ie`
(same reasoning as above — matched to the existing admin-email convention, not confirmed as
the real deploy domain). Also update `CLIENT_URL` in `server/.env.production` — it's currently
still `http://localhost:5173`, a separate pre-existing gap this migration didn't create but
that blocks Universal/App Links from ever verifying against a real domain.

Placeholder appears in:
- `client/ios/App/App/App.entitlements` — `applinks:hellocircle.ie`
- `client/android/app/src/main/AndroidManifest.xml` — the App Links intent-filter's `android:host`
- `server/src/index.ts` — both `.well-known` route handlers reference it in comments/values
- `server/.env.production` — `CLIENT_URL` (separate, pre-existing gap)

## 3. Apple Developer account + Team ID

Needed for: code signing, TestFlight/App Store distribution, and Universal Links (Associated
Domains requires a real Team ID in the AASA response).

1. Enroll at [developer.apple.com](https://developer.apple.com/programs/) if you don't already
   have a paid Apple Developer account ($99/year).
2. Find your **Team ID** — developer.apple.com → Membership (or Xcode → Settings → Accounts →
   your team → shown next to the team name).
3. Register the App ID (`ie.hellocircle.app` or your chosen bundle ID) under Certificates,
   Identifiers & Profiles, with the **Associated Domains** capability enabled.
4. Update `server/src/index.ts`'s `apple-app-site-association` handler — replace `TEAMID` in
   `"TEAMID.ie.hellocircle.app"` with the real Team ID.

## 4. Xcode-only steps (need Xcode installed and open)

These are GUI-only steps that couldn't be done by editing files directly — Xcode auto-generates
matching project.pbxproj entries when you use its Signing & Capabilities tab, which is too
fragile to hand-edit reliably.

Open `client/ios/App/App.xcworkspace` (not the `.xcodeproj`) in Xcode, select the **App**
target → **Signing & Capabilities**:

1. **Signing** — select your Team (from §3), let Xcode manage signing (or set up a manual
   provisioning profile if you prefer).
2. **Associated Domains** — click **+ Capability**, add "Associated Domains", add entry
   `applinks:hellocircle.ie` (or your real domain from §2). This should match — and can safely
   overwrite/regenerate — the `App.entitlements` file already scaffolded at
   `client/ios/App/App/App.entitlements`.
3. **Push Notifications** — click **+ Capability**, add "Push Notifications". This also needs
   **Background Modes** → check "Remote notifications", so push is delivered while the app is
   backgrounded, not just foregrounded.
4. Build once (`Cmd+B`) to confirm it compiles — this is also the first real iOS build
   verification for Phases 1–4, which couldn't be done without Xcode installed.

## 5. Android signing keystore

Needed for: a real (non-debug) Android build, and for **App Links verification**
(`assetlinks.json` must list the signing certificate's SHA-256 fingerprint).

```bash
keytool -genkey -v -keystore hello-circle-release.keystore \
  -alias hello-circle -keyalg RSA -keysize 2048 -validity 10000
```

Store the resulting `.keystore` file and its passwords somewhere durable and **outside version
control** (losing it means you can never update the app under the same package name again).
Then get the SHA-256 fingerprint:

```bash
keytool -list -v -keystore hello-circle-release.keystore -alias hello-circle
```

Update `server/src/index.ts`'s `assetlinks.json` handler — replace the empty
`sha256_cert_fingerprints: []` array with `["AA:BB:CC:...']` (the fingerprint from the command
above, colon-separated hex as `keytool` prints it).

## 6. Google Play Console account

Needed for: Play Store distribution (not required merely to build/sign the APK).

1. Enroll at [play.google.com/console](https://play.google.com/console/) ($25 one-time fee).
2. Create the app listing, upload the signed APK/AAB (built with the keystore from §5).
3. **Note**: Play App Signing (Google re-signs your app for distribution) uses a *different*
   certificate than your upload key by default — if you enable it, use the **App signing key
   certificate**'s SHA-256 (shown in Play Console → Setup → App integrity), not your upload
   key's, in `assetlinks.json`.

## 7. Firebase project (for push notifications)

Needed for: Phase 5's push notifications end to end (FCM for Android, APNs-via-FCM for iOS).

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com/).
2. **Add an Android app** — package name = your bundle ID from §1. Download
   `google-services.json`, place it at `client/android/app/google-services.json`. This alone is
   enough for Android push once the Google Services Gradle plugin is applied (Capacitor's
   template doesn't auto-apply it — add `id 'com.google.gms.google-services'` to
   `client/android/app/build.gradle`'s plugins block and the classpath to the top-level
   `client/android/build.gradle`, per Firebase's own Android setup docs).
3. **Add an iOS app** — bundle ID = your bundle ID from §1. Download
   `GoogleService-Info.plist`, add it to the Xcode project (drag into `App/App/` in Xcode, ensure
   "Copy items if needed" + the App target is checked).
4. **Upload an APNs key** — Firebase Console → Project Settings → Cloud Messaging → Apple app
   configuration → upload an APNs Authentication Key (`.p8`, generated at
   developer.apple.com → Certificates, Identifiers & Profiles → Keys). Required for iOS push to
   work at all through FCM.
5. **Generate a service account** for the server side — Firebase Console → Project Settings →
   Service Accounts → Generate new private key. Downloads a JSON file with `project_id`,
   `client_email`, and `private_key`.
6. Set these in `server/.env` (and `server/.env.production` for real deploys):

   | Var | Value |
   |---|---|
   | `FIREBASE_PROJECT_ID` | the JSON's `project_id` |
   | `FIREBASE_CLIENT_EMAIL` | the JSON's `client_email` |
   | `FIREBASE_PRIVATE_KEY` | the JSON's `private_key`, pasted as-is (its literal `\n` escapes are un-escaped automatically by `server/src/push.ts`) |

   Without these three set, push is logged to the console instead of sent (`[push:dev] ...`) —
   same fail-open pattern as `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` for email.

## Suggested order

1. §1–2 (decide bundle ID + domain) first — everything else references them.
2. §3 (Apple Developer) + §5 (Android keystore) can happen in parallel.
3. §4 (Xcode capabilities) once §3 is done.
4. §6 (Play Console) whenever you're ready to actually distribute.
5. §7 (Firebase) last — it's independent of the others and only affects push.

## Verification checklist once real values are in

- [ ] `curl https://<real-domain>/.well-known/apple-app-site-association` returns the real Team ID
- [ ] `curl https://<real-domain>/.well-known/assetlinks.json` returns a real SHA-256 fingerprint
- [ ] Tapping a magic-link email on a device with the app installed opens the app, not the browser
- [ ] A test Stripe checkout opens in-app and returns to the app on success/cancel
- [ ] A test push notification (via Firebase Console → Cloud Messaging → send test message, or
      through `notifyResident()`) is delivered to a real registered device
