// Server test safety guard.
//
// History: running `vitest` directly once fell back to db/index.ts's default
// DB_NAME ("hello_circle" — PROD) and wrote/deleted real rows there; the first
// fix loaded server/.env so tests ran against hello_circle_dev instead. That
// still pointed tests at a shared development database AND at whatever real
// provider credentials server/.env holds (HC-QA-092).
//
// Now: this file deliberately does NOT load server/.env. Tests run only under
// the isolated profile that scripts/testIsolated.ts (`npm test --workspace
// server`) creates — a disposable hello_circle_test_<runid> database, no
// provider credentials — and src/testProfile.ts verifies that profile,
// including a live identity-marker check, before any test file runs.
import { assertIsolatedServerTestProfile } from "./src/testProfile.js";

await assertIsolatedServerTestProfile();
