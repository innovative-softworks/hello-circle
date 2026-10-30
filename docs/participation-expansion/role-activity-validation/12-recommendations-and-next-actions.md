# 12 · Recommendations and next actions

## Done in this audit (uncommitted, local; not pushed or deployed)
| File | Change |
|---|---|
| `server/src/routes/vendorListings.ts` | RAV-SEC-01: role + capability gate on `POST /claims` |
| `server/src/routes/games.ts` | RAV-DEF-01: no-show refused before the activity day |
| `client/src/components/HostActivitiesTab.tsx` | "Didn't come" hidden before the activity day |
| `server/src/routes/vendorClaimsRole.test.ts` (new) | claims by role and capability |
| `server/src/routes/roleSeparation.test.ts` (new) | negative tests 4, 5, 18: Circle and host separation, resident → partner |
| `server/src/participation/gameQuestions.test.ts` | no-show day rule |
| `docs/participation-expansion/role-activity-validation/00-12` | these reports |

The working tree also holds the earlier, uncommitted pilot-remediation changes (doc 14 of the final validation). Commit the two sets separately when authorised.

## Decisions for the owner
1. **Approve the two fixes** (RAV-SEC-01, RAV-DEF-01) for commit.
2. **Activity taxonomy (RAV-D-05):**
   - add the activity family to Music, Kids & family and Volunteering;
   - add the subcategories Gardening, Video gaming, Meditation and Sketching.
   - This is admin configuration, with no code.
3. **Host safeguarding (RAV-D-06):**
   - Should children's activities, coaching, commercial workshops and ticketed events be partner-only?
   - Needs legal input before the general release.
4. **Manager scope (RAV-D-01):** organisation-wide per listing type (today) is fine for the pilot. Decide later whether larger organisations need listing-scoped managers.
5. **Host questions switch:** the role audit found no blocker to turning it on in a pilot. Still the owner's call (question limit 3).
6. **Correct the product wording:**
   - Partners can't create "activities"; they create experiences, events, programmes and club sessions. People host activities as residents.
   - No-show is live, not switched off.
   - Admin configures form **policy**, not organisation forms.
   - Managers are not limited to assigned listings.

## Not recommended
- **New roles:** Circle moderator, activity coordinator, operations, admin staff. The existing roles and ownership cover them, per the brief's rule.
- **A new application shell or new top-level pages:** the four workspaces exist.
- **Merging the participation tables:** no duplicates were found, and the separation is by design.

## Before the release decision
This role audit is **not** a release approval. The authoritative release assessment remains the Final Independent Validation (CONDITIONAL GO for a web-only, free and cash pilot), plus its pilot remediation. Rerun the full `qa:*` regression (including Stripe TEST) once on the final commit, after these fixes are committed.
