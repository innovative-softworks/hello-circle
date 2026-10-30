# 09 · Security and negative tests

**Environment:** isolated only.
- Server tests run in the disposable `hello_circle_test_<runid>` container (`npm test`).
- Browser and API batches run on a fresh isolated QA DB (`QA_PORT_OFFSET=10`, reset and seeded today), with synthetic personas only.
- No dev or prod database was touched, and no switch was changed outside the test DB.

**Result labels:**
- **PASS (today):** re-run in this audit;
- **PASS (new):** a test added by this audit;
- **PASS (earlier):** evidence from today's Final Independent Validation, on code this audit didn't change in that area.

| # | Case | Result | Evidence |
|---|---|---|---|
| 1 | Resident edits another resident's booking | PASS (today) | FINAL-SEC: `QA_USER_B` gets 404 on GET registration and PUT answers; authorization suite (IDOR-BOOKING) 83/83 |
| 2 | Host edits another host's activity | PASS (today + new) | FINAL-SEC, IDOR-HOST; `roleSeparation.test.ts` (PUT with a valid body → 403, unchanged) |
| 3 | Host views another host's private answers | PASS (today) | FINAL-SEC: `/participants/manage` 403; `gameQuestions.test.ts` |
| 4 | Circle member manages an organiser-only activity | PASS (new) | `roleSeparation.test.ts`: member can't attach as the Circle's own (403), can't edit the Circle (403) |
| 5 | Circle organiser accesses an unrelated Circle | PASS (new) | `roleSeparation.test.ts`: rename, promote, remove, announce in another Circle → 403, unchanged |
| 6 | Vendor accesses another organisation | PASS (today) | FINAL-SEC, IDOR-VENDOR, STAGE-B-* |
| 7 | Vendor creates a listing without the capability | PASS (today) + **fixed gap** | config-capabilities batch; **`POST /vendor/claims` had no capability check (RAV-SEC-01), fixed**, `vendorClaimsRole.test.ts` |
| 8 | Vendor uses a prohibited category | PASS (earlier + source) | the only vendor category write is `PUT /vendor/classification/:type/:id` → `assertOrgMayAssign`; create routes accept no category; config-categories batch, `categoryPolicy.test.ts` |
| 9 | Finance views registration answers | PASS (today) | config-operations: `answersVisible:false`, CSV 403; `vendorOrders.test.ts` |
| 10 | Check-in staff access staff notes | PASS (today) | `requireVendor` allow-list (only `/api/vendor/door*`); FINAL-SEC (record 403) |
| 11 | Read-only staff mutate records | PASS (today) + **fixed gap** | FINAL-SEC (draft, publish, note, send, CSV → 403); **claims was 201 → now 403** |
| 12 | Revoked staff on cached routes | PASS (today) | authorization suite (D08-STAFF), FINAL-SEC suspended account; checked on every request |
| 13 | Direct API bypass of disabled host questions | PASS | `gameQuestions.test.ts` "off by default": set-up 404, join answers ignored (test DB only) |
| 14 | Cross-organisation report exports | PASS (earlier) | `vendorReports.test.ts`, FINAL-SEC |
| 15 | Unauthorised staff assignment | PASS | staff invite, role and remove are owner-only (`org.ts`: invited staff → 403); check-in assignment: owner + managers (`capabilities.test.ts`) |
| 16 | Admin accesses restricted sensitive information | PASS (source) | no admin route selects `registration_answers` or `medical`; admins can't pass `requireVendor`; governance shows counts |
| 17 | Host attempts unrestricted form configuration | PASS | `/vendor/forms/game/*` → 404; host questions library-only, at most 3 |
| 18 | Cross-context privilege escalation | PASS (today + new) | resident session → `/api/vendor/*` 401 (`roleSeparation.test.ts`); STAGE-B-MANAGE, CLOSURE-LINK(-RACE) in the authorization suite; `checkin_staff` can't use `requireVendorOrAdmin` routes (uploads) |

## Vulnerabilities confirmed and fixed
| ID | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| RAV-SEC-01 | **P2** (authorisation) | `POST /api/vendor/claims` had no staff-role or capability check. Read-only, finance, communications and check-in staff (and organisations without `venues` / `clubs`) could file a claim to take over an unclaimed centre or club. Impact limited: an admin still approves every claim (`queues.decide`) | same gates as creating that type: `assertPlatformRole(centre_manager / facility_manager)` + `assertCapability(venues / clubs)` (`vendorListings.ts`) | `vendorClaimsRole.test.ts`: 3 tests; **fail 3/3 on the old code**, pass on the fix |
| RAV-DEF-01 | **P2** (integrity) | A host could mark a participant "Didn't come" days **before** the activity. The no-show blocks that participant's review of the host and shows "missed" in their My Life. The route isn't behind a switch (live since Phase N) | refuse with 409 until the activity day, the same rule as partner attendance (`vendorExperiences.ts`); the button is hidden until then | `gameQuestions.test.ts` (409 and no attendance row before the day; 200 on the day) |

**Not a vulnerability (noted):** `PUT /api/games/:id` validates the body before checking ownership. A non-host with an invalid body gets 400 instead of 403. Nothing is written either way.

## Suites re-run today
| Suite | Result |
|---|---|
| `qa:authorization` | 39 batches, **83 passed, 0 failed** |
| `booking-final-security` (FINAL-SEC probe) | **passed** |
| `booking-config-capabilities` | **passed** |
| `booking-config-operations` | **passed** |
| `booking-final-a11y` | **passed** |
