# 06 · Mobile compatibility

## Scope decision (owner, 2026-10-30)
During this validation the owner stated: **"i didnt develop any mobile app."** Mobile is therefore **out of scope for this release**. The release under evaluation is **web only**.

On this machine there is a separate local repository, `hello-circle-mobile` (Expo / React Native). The validation brief listed it, and earlier participation phases added local commits to it on branch `feature/registration-forms`:
- `f3f48da`: registration forms in booking flows;
- `ea46242`: host questions;
- `a509d86`: shared-types resync, made during this validation.

Nothing there is pushed, built for a store or released. It is **not** treated as a shipped channel.

## What was checked before the scope decision (for the record only)

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | pass |
| Lint (`expo lint`) | pass |
| Jest | 41/41 pass (7 suites) |
| Shared `@hello-circle/types` vs web `packages/types` | identical after `a509d86` |
| Untracked `package-lock.json` | npm lockfile v3 for the npm workspace (`README`: `npm install`); never committed; **left untouched** |
| Simulator (iPhone 17 Pro, iOS 26.5) | An existing debug build installed and **launched**, rendering the Home tab from the current JS bundle. **Sign-in, forms, submission, touch and keyboard were NOT TESTED.** macOS denies synthetic clicks here (error −25204), and the iOS "Open in app" prompt can't be dismissed without a tap. Stopped on the owner's scope decision. |

**Device validation: NOT TESTED.** Unit tests are not counted as device validation.

## What this means for the web release
- **The server contract is channel-agnostic:**
  - every booking entry point refuses a listing's published form if it isn't answered (`409 form_required`, `409 questions_changed`, `400 answer_required`);
  - `compatibility.test.ts` covers this, including a client that sends no form.
- **No other client can bypass forms:** any client other than the web app (including any future app) gets a clear refusal, *"This listing now asks registration questions — reload the page to answer them (on the app, update it first)"*, instead of a booking without answers.
- **No minimum app version is needed** while no app is distributed.
- **If an app is ever released:**
  - this validation's mobile items become blocking: device E2E, minimum version and update path;
  - the `feature/registration-forms` branch is the starting point.

## Gate
**Gate 7, mobile compatibility: NOT APPLICABLE** to this web-only release (owner scope decision). Re-open it if a mobile app is distributed.
