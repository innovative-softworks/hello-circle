# 06 — Navigation QA Report (2026-10-22)

**Environment:**
- isolated QA containers (disposable MySQL, Stripe test mode, real email blocked);
- read-only preview on `:5573` for screenshots (all writes aborted);
- API `:3001` (production-designated database) was not used.

## Automated

| Command | Result |
|---|---|
| `npm run test --workspace client` (includes `navConfig.test.ts`) | 302 passed |
| `npm run build --workspace client` | succeeds |
| `npm run qa:lifecycle` (includes HC-QA-001 tab bar, sheets, join-bar stacking) | 52 passed |
| `npm run qa:authorization` | 83 passed |
| `QA_PRODUCT_CONTINUE=1 npm run qa:product` (includes a11y-c header semantics, PUB-09/10 no-venue-gate links) | 80 passed, 1 skipped by design |

## Manual / scripted checks

| Check | 1920 | 1440 | 1280 | 1024 | 768 | 390 | 320 |
|---|---|---|---|---|---|---|---|
| Explore panel height (px) | 334 | 353 (was 422) | 390 | 354 (was 464) | sheet | sheet | sheet |
| Every Explore/Start link loads a page with a heading | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Escape closes the panel and focus returns to the trigger | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Horizontal overflow | none | none | none | none | none | none | none |
| Tab bar present | — | — | — | — | ✓ | ✓ | ✓ |

**Roles** (from code and the existing test suites, not walked by hand in this pass):
- visitor (`signInHref` on create flows);
- resident, host and organiser (Manage items);
- vendor (no "List your venue"; Partner switch);
- admin (admin items only with an admin session).

## Not tested live

- Screen readers.
- Expired-session navigation.
- The live production site.

## Remaining issues

See README "Outstanding decisions".
