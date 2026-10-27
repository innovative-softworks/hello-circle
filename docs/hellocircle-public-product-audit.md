# HelloCircle — Public Website & Resident Experience Audit

**Date:** 2026-10-21 · **Branch:** `feature/workspace-detail-pages` @ `315f0d2` (working tree clean apart from `.DS_Store` and `docs/Untitled`, both untouched) · **Mode:** audit only — no application code, schema, settings, Stripe configuration, permissions or business rules changed; nothing committed, pushed or deployed.

| Document | Contents |
|---|---|
| this file | Method, product understanding, findings by area, backend readiness, template consolidation, executive summary |
| `hellocircle-public-page-inventory.md` | 64 actual page routes; 73 target entries mapped with one status each |
| `hellocircle-public-ux-ui-audit.md` | Top 20 UX/UI problems, homepage assessment, typography/colour/imagery/interaction/mobile |
| `hellocircle-public-journey-audit.md` | Journeys A–H step by step |
| `hellocircle-public-gap-matrix.md` | 43 gaps (PUB-01…43) with evidence, priority, effort |
| `hellocircle-public-improvement-roadmap.md` | Six phases and the decisions needed |
| `public-audit-2026-10-21/` | 17 representative screenshots, the sweep script and raw sweep results (JSON) |

---

## 1. Method and environment

**Read:** `CLAUDE.md`, `docs/hellocircle-product-context.md`, the 2026-10-11 sitemap audit, `hellocircle-qa-results.md`, `client/src/App.tsx` (routes and launch gates), `navigation/navConfig.ts`, `components/Footer.tsx`, every public page component touched below, `api/core.ts`, `api/*`, and the relevant server routers (`guestAuth.ts`, `games.ts`, `circles.ts`, `reviews.ts`, `discover.ts`, `favourites.ts`).

**Environment safety check (done first):**
- The API on **`:3001` (PID 43811) holds open MySQL connections to `hello_circle`** — the production-designated database. It was **not used** for anything. You may want to check why a dev API is pointed at `hello_circle`.
- Used instead: an existing dev API on **`:3301` → `hello_circle_dev`** (verified via MySQL process list), behind a separate audit-only Vite on `:5573` with `VITE_VENUE_PAGES_PUBLIC=true` set as an environment variable so the gated venue pages could be inspected. Its config lived in `node_modules/.audit-pub/` and was removed afterwards; the Vite process was stopped.
- The dev API has **real SMTP configured**, so no sign-up or other mail-sending request was made. Every non-GET request was aborted in the browser.
- For signed-in pages one `guest_sessions` row was inserted in `hello_circle_dev` for the seeded resident `demo-resident-6` and **deleted afterwards** (1 row). The one-time Terms dialog was hidden with injected CSS for screenshots rather than accepted, so no resident data changed.

**Browser coverage:** 59 public routes × 5 widths (390, 768, 1024, 1440, 1920) = 295 renders; 26 signed-in routes × 2 widths (390, 1440) = 52 renders. Checks per render are listed in the UX/UI audit. Chromium only; no screen-reader or Safari/Firefox pass.

**Not verified in this audit (and why):** any booking, join, enrol, save, follow, review, cancel or payment submission (writes + live SMTP); Stripe; the production site. These rely on `[prior-QA]` evidence where it exists, and that evidence predates commit `315f0d2` (workspace UX pass), which didn't change public booking code paths but wasn't re-tested.

## 2. Product as built (short)
HelloCircle's public site serves **guests** (anonymous, can book venues/clubs/experiences/programmes by client id), **residents** (password, magic link or Google; required to join activities, Circles, save, follow, chat, review), **hosts** (residents who run activities/Circles; Verified Host badge allows paid sessions), and is the front door for **partners** (vendor signup) — admin isn't public. Six participation types run in parallel (`bookings`, `registrations`, `program_enrollments`, `experience_bookings`, `game_participants`, `circle_members`), deliberately not unified.

The public product is substantially built. Discovery, six detail templates, the booking kit, Stripe checkout with payment-review states, cancellations, Circles with planning/polls/invites/chat, My Life, a 17-tab profile, help guide, policy CMS, complaints and appeals all exist and render. The gaps are concentrated in **legal content, a handful of real bugs, booking management, and consistency**.

## 3. Findings by area (details in companion docs)

**Discovery (Phase 3).** Works across Explore, Activities, Programmes, Experiences/Adventures/Volunteer, Circles, Browse, local landings and Free Time Mode. Search, location, date, chips, filters, sort, result counts, map (on four lists), save hearts, empty and error states are present. Problems: results below the fold on mobile (PUB-18), four different header/filter patterns (PUB-19), placeholder imagery (PUB-28/16), programme sessions duplicated (PUB-17), undated experiences listed (PUB-13), venues gated with a dead "Compare places" button (PUB-09), thin local landings (PUB-25). Homepage verdict in UX §2.

**Detail pages (Phase 4).** All six types have title, category, description, media, location, date/time, capacity/spots, price, organiser, reviews (where reviewable), share/save/report, a desktop rail card and a mobile sticky bar. Information structures are appropriately different (venue: rooms/hours; programme: sessions; Circle: plans/members). Problems: action-row hierarchy (PUB-27), 404 handling (PUB-14), member-first Circle order (PUB-30), thin host/provider profiles (PUB-38). Event detail and room detail are correctly combined rather than separate pages.

**Booking and checkout (Phase 5).** The booking kit is the most mature part: numbered steps, server-side quotes (VAT, fee, coupon, credits, deposits — **not reviewed or changed**), cancellation wording derived from server facts, payment result states for confirming/paid/pending/review/refund-pending/failed/not-found, and self-cancel per type. Prior QA: `qa:stripe` 51/51, `qa:booking` 38 passed. Problems: confirmation title (PUB-04), no booking record page (PUB-12), refund policy unpublished (PUB-03), late programme enrolment undefined (PUB-17). **Financial/business-rule gaps to decide separately:** late enrolment pricing; whether checkout should block until policies are published; paid hosting at launch.

**Circles (Phase 6).** Backend is complete for launch scope: 40 endpoints covering open/approval join, leave, members (promote/demote/mute/remove), invitations (+ revoke, respond), plan ideas → confirmed activity, polls (vote/close), announcements, moments, moderation, share, report. "Discussions" = one group chat per Circle plus announcements — adequate; threads are deferred (PUB-42), not a gap to build now. Recommended structure: keep one route `/circles/:id` with anchor tabs for Planning/Polls/Members/Moments; edit/manage stays in `/manage/circles/:id`.

**Account and My Life (Phase 7).** Sign-in (password, magic link, Google), Terms gate, onboarding popup, profile with household, saved (with statuses), following, routines, passes, receipts, notifications + preferences, privacy & accessibility prefs, data download, erasure request, deactivation, Verified Host application, safety (blocked people), help. Multi-role switching (resident ⇄ vendor) exists in the header and passed `hc-og01-switch.spec`. Problems: false expiry alert (PUB-05), Chats direct-load (PUB-06), My Life doesn't lead with upcoming plans (PUB-08), dead credit tab (PUB-22), stale copy (PUB-21), clipping (PUB-23), no review prompts (PUB-32). No private data exposure was observed in public pages; the signed-in Circle page shows member initials/avatars only.

**Host and vendor entry (Phase 8).** `/become-a-host`, `/for-venues`, `/pricing`, `/vendor/signup`, `/games/host`, `/circles/start`, Verified Host application. Problems: paid-hosting claim contradicts product (PUB-11), pre-launch banner on For Venues (PUB-10), no partner/host resources (PUB-41). `/pricing` honestly says fees are being finalised — keep until the fee decision.

**Information, support, legal (Phase 9).** About, Contact (routed mailto, no form — fine), Complaints & appeals, Help guide (5 pages), Policy Centre with 18 documents. **All 18 policy documents are unpublished on dev**; `/privacy` falls back to a page with visible placeholders; `/cookies` intro contradicts its table; Help & Support and Safety Centre are only inside the signed-in profile. Operator name to use: Innovative Softworks Technologies Limited (the footer already says "a product of iSoftworks, the brand of Innovative Softworks Technologies Limited"). No address or registration details were invented. **Everything in Phase 9 that states rights, refunds, liability or safety requires legal approval.**

## 4. Backend and data readiness (Phase 12)
No P0 or P1 item needs a database migration.

| Gap | Blocker type | Required / reused API | Data model | Validation & permissions | Audit | Migration | Risk |
|---|---|---|---|---|---|---|---|
| PUB-01/02/03/36 legal | Legal approval | Reuse policy CMS (`/api/policies`, admin publish flow) | existing `policy_*` tables | admin `policies.*` permission (D-02) | existing policy audit | No | Low once text approved |
| PUB-12 booking record | Frontend + small backend | Reuse `GET /residents/me/receipts/:ref`, per-type `mine` endpoints, existing cancel endpoints; optional `GET /residents/me/orders/:kind/:ref` aggregate | existing tables | resident owns row (`resident_id`) or client id; never expose another person's booking | none (read) | No | Medium — six table shapes; keep per-kind adapters |
| PUB-13 undated experiences | Business decision | Optional `?hasUpcoming=1` on experiences list | existing | public read | – | No | Low |
| PUB-25 local landings | Backend small | Same endpoint; normalise hyphens; add programmes/Circles | existing | public | – | No | Low |
| PUB-32 review prompts | Backend small | New `GET /reviews/eligible/mine` built on `isEligibleToReview()` | existing `reviews` + participation tables | resident only | – | No | Low |
| PUB-38 profiles | Backend check | Expose `residents.host_bio` on `/hosts/:id` if not already | existing column | public fields only | – | No | Low (check privacy of host fields) |
| PUB-08 My Life coming-up | Investigation | `/residents/me/participation`, `/circles/mine` | existing | resident | – | No | Unknown until traced |
| PUB-42 threaded discussions | Deferred | would need new endpoints | new tables | moderation required | yes | **Yes** | High — not recommended now |
| Everything else | Frontend only | – | – | – | – | No | Low |

## 5. Design system and reusability (Phase 13)
| Template family | Existing components | Duplication found | Recommended reusable pieces | Missing states | Responsive issues | Migration risk |
|---|---|---|---|---|---|---|
| 1 Editorial landing (Home, For Venues, Become a host, About) | `homeEditorial.css` (`--hx-*`), `CtaBand`, forVenues/* | Home's own token set parallel to `theme.ts` | Map `--hx-*` to shared tokens; `EditorialBand` | Trust row | Home 9.3 screens at 390 | Low |
| 2 Search / discovery | `BrowseLayout`, `ListingCard`, `DiscoverCard`, `DiscoveryMap`, `ExperienceKindBrowse` | 4 header/filter implementations | `DiscoveryHeader`, `FilterBar`, grouped programme card | No-photo card, "no dates yet" | Results below fold at 390 | Medium — URL params must stay backward compatible |
| 3 Activity / experience detail | `GameJoinCard`, `MobileJoinBar`, `PhotoGallery`, `Reviews` | Share/Save/Report row ×6; rail shell ×6; error block ×6 | `DetailActions`, `JoinRail`, `DetailNotFound`, `TrustRow` | 404 variant | sub-24px inline links | Low |
| 4 Programme detail | enrol popup, sessions list | as above | `SessionList` | "already started" | – | Low |
| 5 Venue / facility detail | `CentreDetail`, `ClubDetail`, rooms | centre/club near-duplicates | shared venue facts block | – | – | Low (gated) |
| 6 Circle / community | `CircleDetail` sections, `CircleMoments` | – | anchor tabs via `useUrlParam` | member-first order | 8.7 screens at 390 | Medium — biggest page (1,101 lines) |
| 7 Public profile | `HostProfile`, `ProviderProfile` | two unrelated layouts | `PublicProfile` | bio, rating summary | provider 9 screens at 768 | Low |
| 8 Booking / checkout | `components/booking/*` (kit, `checkout.tsx`, `policy.ts`, `useQuote`) | already shared — good | booking record page using the kit's summary components | booking record | – | Low; **don't touch pricing** |
| 9 My Life / account | `MyBookings.tsx` (1,275 lines), `Profile.tsx` (1,803 lines) | profile rows with mixed raw buttons | `NextUp` feed, settings row that stacks | coming-up for all types | clipping at 390 | Medium |
| 10 Create / edit form | `components/form.tsx` convention | Suggest a place, household, host application don't use it | adopt `FieldLabel`/`FormErrorSummary` | – | – | Low |
| 11 Help / content | `HelpGuide*`, `Policies`, `CmsPolicy` | Help & Safety exist only inside Profile | public `/help`, `/safety` reusing the guide layout | published policies | Help guide Explore 11 screens | Low |

These stay separate templates on purpose — a venue, a programme and a Circle answer different questions. Share the *parts* (actions, rail, trust row, not-found, date formatting), not one universal page.

## 6. Executive summary (Phase 17)

Counting rules: routes are counted from the main router (`App.tsx:351-465`); each of the 73 target entries has exactly one status; each gap is counted once under its highest priority.

1. **Actual public routes:** **64 page routes** (public, resident and auth), plus 5 redirect-only routes and 1 catch-all; 13 workspace routes and 1 dev-only route are excluded (84 total in the router).
2. **Fully supported target entries:** **36 of 73** (21 Complete + 15 Combined into a complete page).
3. **Partially supported:** **26 Partial**, plus **5 Combined** entries that inherit a Partial host (31 in total).
4. **Missing:** **4** (Partner Resources; Terms, Cancellation & Refund, Accessibility — the last three are unpublished legal content, not missing code). Plus **1 Broken** (Privacy) and **1 Deferred** (Credits).
5. **Should be combined rather than built separately:** **20** entries (search results, category landing, session detail, room detail, event detail, date/time, tickets, booking review, payment result, Circle members/events/polls/planning, edit Circle, account setup, my bookings, my activities, edit profile, account settings, how it works).
6. **Broken:** `/privacy` placeholder page (PUB-01); confirmation title always "Payment confirmed" (PUB-04); `/chats` on direct load (PUB-06); false "session expired" alert for guests (PUB-05); "Compare places" dead-ends while venues are gated (PUB-09); 404s shown as retryable errors (PUB-14).
7. **Top 10 launch blockers:** PUB-01 Privacy placeholders · PUB-02 Terms unlinked/unpublished · PUB-03 refund/booking terms unpublished · PUB-04 payment title · PUB-05 false expiry alert · PUB-06 Chats · PUB-07 Help/Safety behind sign-in · PUB-10 "launches soon" on For Venues · PUB-11 paid-hosting claim · PUB-36 accessibility statement.
8. **Top 20 UX/UI improvements:** see `hellocircle-public-ux-ui-audit.md` §3 — results in screen 1; one discovery header; no-photo card; matched imagery; My Life "coming up"; no false alerts; detail action hierarchy; member-first Circles; shorter Home with one search; terminology; one date format; real not-found; empty-state copy; form labels; heading order; phone row stacking; page-level buttons; grouped programmes; booking record page; trust surfaces.
9. **Five templates to redesign first:** (1) Search/Discovery list, (2) My Life, (3) Activity/Experience detail parts (actions, rail, trust, not-found, no-photo), (4) Help/Content + Policy pages, (5) Circle detail (member view). The booking kit needs a record page, not a redesign.
10. **Missing backend capabilities:** none for P0/P1 except investigation of PUB-08; small reads for the booking record aggregate (optional), review-eligibility list (PUB-32), experiences "has upcoming" filter (optional), local-landing matching (PUB-25). Threaded Circle discussions would need new tables — deferred.
11. **Doable without any business-rule change:** PUB-04, 05, 06, 07 (structure; wording needs sign-off), 08, 14, 15, 18, 19, 21–24, 27–33, 35, 38, 39, 40 and the technical part of 01/02/03 (links, fallback removal) once text is published.
12. **Needs your approval:** legal publication of the seven policies and operator details; venues/clubs at launch; paid hosting by Verified Hosts; late programme enrolment; undated experiences; canonical terms and CTA colour rule; booking-record scope; Home section priorities and For Venues copy. (Roadmap §"What needs your approval".)

**Prioritised plan:** Phase 1 blockers (mostly S, gated on legal) → Phase 2 discovery/detail templates → Phase 3 booking record + review prompts → Phase 4 My Life and Circles → Phase 5 visual consistency → Phase 6 accessibility/performance and a `qa:public` regression spec. Details and dependencies in `hellocircle-public-improvement-roadmap.md`.

**Also worth your attention (outside this audit's scope):** the dev API on port 3001 is connected to the `hello_circle` (prod-designated) database.
