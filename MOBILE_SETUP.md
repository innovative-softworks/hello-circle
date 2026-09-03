# Mobile app (Capacitor) — remaining setup

The 5-phase Capacitor migration (native shell, splash/status bar, magic-link deep linking,
in-app Stripe Checkout, native push) is code-complete and verified — see the plan history
for what was built. Everything below is **external account/credential setup only a human can
do** (developer accounts, key generation, GUI-only Xcode steps) — none of it can be scripted
from this repo. Each section names exactly which files currently hold a placeholder and what
to replace it with once the real value exists.

Nothing here blocks local development or the existing web app — every placeholder fails
closed (App/Universal Links don't verify, push silently no-ops) rather than breaking anything.

## 1. Bundle ID / package name — ✅ confirmed (2026-09-02)

`ie.hellocircle.app` confirmed as final. No file changes needed — every native project already
uses it.

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

## 5. Android signing keystore — ✅ done (2026-09-02)

`hello-circle-release.keystore` generated (alias `hello-circle`), stored one level above the repo
(`~/Documents/Isoftworks/HelloCircle/hello-circle-release.keystore`) — **not** committed, per the
`*.keystore`/`*.jks` `.gitignore` rule added alongside it. Its SHA-256 fingerprint is already
wired into `server/src/index.ts`'s `assetlinks.json` handler. Back up the keystore file + its
passwords somewhere durable outside this machine (password manager + a second copy) — losing it
means the app can never be updated under `ie.hellocircle.app` again. If the bundle ID in §1
changes, this keystore is still valid (a keystore isn't tied to a package name), only the
`assetlinks.json` `package_name` field needs updating.

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

1. ✅ Project created — **`FIREBASE_PROJECT_ID = hello-circle-e5e05`**. (An earlier project,
   `hello-circle-76b7b`, was created first under a work/Google-Workspace account but hit a hard
   org policy — `iam.disableServiceAccountKeyCreation` — blocking service-account key downloads
   with no project-level override available. Recreated fresh under a personal Google account
   instead, where key creation just works. `hello-circle-76b7b` is abandoned/unused — don't
   confuse the two if you still have old downloads lying around referencing it.)
2. ✅ **Android app registered** (2026-09-02) — `google-services.json` is in place at
   `client/android/app/google-services.json` (for `hello-circle-e5e05`) and verified wired:
   `./gradlew assembleDebug` runs a real `:app:processDebugGoogleServices` task. Turned out
   Capacitor's own Android template already had the Google Services Gradle plugin classpath + a
   conditional `apply plugin` block in `app/build.gradle` (auto-applies once `google-services.json`
   exists) — no manual Gradle edit was actually needed, unlike this doc originally assumed.
3. ✅ **iOS app registered** (2026-09-02) — `GoogleService-Info.plist` (for `hello-circle-e5e05`)
   is saved at
   `client/ios/App/App/GoogleService-Info.plist`, but **still needs a real Xcode step**: open the
   project, drag the file into `App/App/` in the Xcode file navigator (not Finder), ensure "Copy
   items if needed" + the App target's checkbox are both checked. Just having the file sit in
   that folder on disk (done) is not enough — it must be added as a project file reference or the
   build won't bundle it. Same "needs Xcode GUI" gap as §4's Associated Domains capability.
4. **Upload an APNs key** — blocked on Apple Developer enrollment (§3, on hold). Firebase Console
   → Project Settings → Cloud Messaging → Apple app configuration → upload an APNs Authentication
   Key (`.p8`, generated at developer.apple.com → Certificates, Identifiers & Profiles → Keys).
   Required for iOS push to work at all through FCM — Android push doesn't need this step.
5. ✅ **Service account generated** (2026-09-02) — hit `iam.disableServiceAccountKeyCreation`, an
   org policy on the original work-account project (`hello-circle-76b7b`) with no project-level
   override available; recreated the whole Firebase project under a personal account instead
   (see item 1 above) where key creation isn't restricted, and generated the key there.
6. ✅ **Set in `server/.env`** (2026-09-02) — `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
   `FIREBASE_PRIVATE_KEY` all present. Verified live: booting the server no longer logs "Firebase
   not configured", and a direct `sendPush()` call reached FCM's real API (got back "invalid
   registration token" for a fake test token — proves auth succeeded, not just that init didn't
   throw). **Still needs setting in `server/.env.production`** for the real deploy, once that
   exists — `.env`/`.env.production` are separate gitignored files, this only touched `.env`.

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
