# HelloCircle — Public Improvement Roadmap

**Date:** 2026-10-21 · Proposal only — nothing here is approved or started. Gap IDs refer to `hellocircle-public-gap-matrix.md`. Sizes: S ≤ 1 day, M 2–5 days, L 1–2 weeks, XL more (one engineer who knows the codebase). No phase changes Stripe, VAT, fees, deposits, refunds, settlement, payouts, booking lifecycle or permissions; items that touch a business rule are listed as **decisions**, not work.

## Sequencing logic
1. Fix what is **wrong or misleading** first (legal, payment wording, false errors) — small, independent, high trust impact.
2. Then the **templates people convert on** (discovery list, detail, confirmation/booking record), because later visual work should land on the consolidated templates, not on six copies.
3. **My Life and Circles** next — they depend on the booking record page and shared date/empty-state components from phase 2–3.
4. **Global visual consistency** after the templates exist (type scale, tokens, terminology), so it's one migration per template.
5. **Accessibility, performance and regression** run alongside, closing with automated checks so the fixes stay fixed.

---

## Phase 1 — Critical blockers (before any public launch)
| Item | Gap | Size | Depends on |
|---|---|---|---|
| Legal text approved and published in the Policy Centre: Privacy, General Terms, Customer Booking Terms, Cancellation & Refund, Community & Safety, Cookie, Accessibility Statement | PUB-01, 02, 03, 36, 34 | owner/legal; S engineering | **Your approval + legal review**; operator details (address, registration) |
| Link "Terms" in sign-up, Google completion and Terms gate; link refund policy from checkout summary and confirmation; retire the placeholder Privacy fallback | PUB-02, 03, 01 | S | Publication above |
| Payment result title from actual state | PUB-04 | S | – |
| Stop false "session expired" alert for guests | PUB-05 | S | – |
| Chats initial view after session load | PUB-06 | S | – |
| For Venues: pre-launch banner/section only while gated | PUB-10 | S | Copy confirmation |
| Become a host: correct paid-hosting FAQ | PUB-11 | S | **Decision** on paid hosting at launch |
| Venue/club launch decision; hide "Compare places" while gated | PUB-09 | S | **Decision** |
| Public `/help` and `/safety` pages; repoint footer | PUB-07 | M | Safety wording approval |

**Exit check:** signed-out visitor can read every policy linked from sign-up and checkout; no placeholder text on any public page; payment result title matches the shown state for all 8 `PaymentSuccess` states; fresh-context `/my-life` has no `role=alert`.

## Phase 2 — Discovery and detail pages
| Item | Gap | Size | Depends on |
|---|---|---|---|
| Shared `DiscoveryHeader` + `FilterBar` (same URL params) on Explore, Activities, Programmes, Experiences/Adventures/Volunteer, Browse; results in screen 1 at 390px | PUB-18, 19 | L | – |
| Group programme sessions into one result; "starts / already started" label | PUB-17 | M | **Decision** on late enrolment (copy only until then) |
| Undated experiences: label "No dates yet" or filter | PUB-13 | S–M | **Decision** show/hide |
| Typographic no-photo card + hero variant | PUB-28 | M | – |
| `DetailActions` (Save primary, Share, Report in overflow) on all six detail pages | PUB-27 | S–M | – |
| `notFound` variant of the load-error block | PUB-14 | S | – |
| Public profile template (host + provider): bio, verification, rating, hosted count, upcoming | PUB-38, 24 | M | Confirm `host_bio` is exposed (S backend) |
| Local landing: hyphen normalisation, wider sources, inbound links | PUB-25 | M | Which pages to index |
| Launch content: real or category-matched photography for launch listings | PUB-16 | content | Owner |

## Phase 3 — Booking and participation
| Item | Gap | Size | Depends on |
|---|---|---|---|
| Booking record page `/bookings/:kind/:ref` (status, date, people, cancellation facts from server, receipt, cancel, calendar, contact) | PUB-12 | L | Reuses receipts + per-type "mine" endpoints; no schema change |
| Venue room cards deep-link into booking step 2 | Journey C | S | Venue launch decision |
| Confirmation pages link to the booking record and the published policy | PUB-03, 12 | S | Phase 1 + record page |
| Review prompts after attendance; "My reviews" list | PUB-32 | M | New read endpoint over existing eligibility logic |

## Phase 4 — My Life and community
| Item | Gap | Size | Depends on |
|---|---|---|---|
| My Life: "Coming up" across all six participation types first; trace missing Circle plan and 5-vs-3 count; no empty grid; stats last; Sign out out of the page header | PUB-08, 33 | M | Booking record page (rows link to it) |
| Circle detail member-first order + anchor tabs (`?section=planning|polls|members|moments`) | PUB-30 | M | – |
| Saved copy, hide switched-off Credit tab, profile row stacking on phones | PUB-21, 22, 23 | S | – |
| Remove nested button in `MyLifeCircles` | PUB-31 | S | – |
| Volunteer: hide when empty or add a "suggest a cause" state | PUB-37 | S | Supply decision |

## Phase 5 — Global visual consistency
| Item | Gap | Size | Depends on |
|---|---|---|---|
| Terminology decision + copy sweep (Activity/Session/Programme/Enrol/Save/HelloCircle) | PUB-20 | M | **Your approval of terms** |
| Type scale tokens (6–7 steps); migrate detail, discovery, My Life templates | UX §4 | L | Phase 2–4 templates |
| Map Home `--hx-*` tokens onto shared tokens | UX §5 | M | – |
| CTA colour rule (green primary, orange editorial accent) | UX §5 | S | Your approval |
| Home: hide header search on `/`, bring listings to screen 2, trim editorial bands, add trust row | PUB-26 | M | Phase 1 legal (trust row claims) |
| One Irish date/time formatter everywhere; Ireland-time greeting/datelines | PUB-24, 39 | S | – |
| Business vs resident sign-in clarity | PUB-35 | S | – |

## Phase 6 — Accessibility, performance and regression
| Item | Gap | Size |
|---|---|---|
| Label every input via `components/form.tsx`; name icon buttons | PUB-15 | M |
| Heading levels on lists/detail/profile | PUB-29 | S |
| 24px minimum targets for inline links in cards/rows | UX §8 | S |
| Add this audit's sweep checks to `qa:check` / a new `qa:public` spec: no overflow at 5 widths, one H1, no skips, no unlabelled inputs, first result above 600px at 390, no `role=alert` for guests, payment title per state | all | M |
| Production performance pass (image sizes per card, LCP on Home/detail) — not measurable on the local dev server | – | M |
| Map on Explore/Activities/Circles; partner and host resources; threaded Circle discussions | PUB-40, 41, 42 | later / deferred |

## What needs your approval before work starts
1. Legal publication of the seven policies and the operator details (Phase 1).
2. Whether **venues and clubs** are public at launch (PUB-09).
3. Whether **Verified Hosts can charge** for sessions at launch, so the marketing copy can match (PUB-11).
4. **Late enrolment** in programmes that have started (PUB-17).
5. Show or hide **experiences with no dates** (PUB-13).
6. Canonical **terminology** and **CTA colour** rule (PUB-20, UX §5).
7. Scope of the **booking record page** (all six kinds, or paid kinds first) (PUB-12).
8. Home section priorities (PUB-26) and the For Venues post-launch copy (PUB-10).
