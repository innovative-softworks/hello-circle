# HelloCircle — proposed commit plan

_2026-10-17. Proposal only; nothing is committed. Branch `feature/commerce-engine` at `1ba8c7b`._

Every step below was rebuilt in a scratch copy of `HEAD` and type-checked (client, server, tests): **0 errors after every commit**. The state after C3 also passes the unit suites (server 1005, client 281: the counts before this QA pass). The state after C7 is byte-identical to today's working tree.

Files edited by more than one phase go in the latest phase's commit, except the 20 files that this QA pass and the Option A change edited on top of earlier work. Those were split exactly: their earlier version goes into C2 and this pass's edits into C4/C5, reconstructed from the exact edits made this session and verified by the build and unit tests above. The redesign and OG work can't be split further by file and still build, so they share C2.

**Not committed:** `.DS_Store`, `docs/Untitled` (a copy of an owner prompt). Built output (`client/dist`, `server/dist`) and `.qa-data/` are gitignored.

**How it would be executed (on approval):** with a temporary git index (`GIT_INDEX_FILE`, `git hash-object -w`, `git update-index --cacheinfo`, `git commit-tree`), so the working tree is never rewritten and nothing is discarded. Then `git status` must show only the two excluded files. Each message ends with the Co-Authored-By line. Push and PR only on a separate approval.

| # | Message | Files |
|---|---|---|
| C1 | `docs: workspace audit and operational gap analysis` | 8 |
| C2 | `feat: workspace redesign and OG-01…OG-32 operational backlog` | 238 |
| C3 | `feat(commerce): tell partners once about failed payouts and Pro past-due payments (OG-05)` | 2 |
| C4 | `fix: final QA pass — server-paged Vendors and All listings, erasure never 'completed', MFA key handling` | 15 |
| C5 | `security: limit partner customer personal data by staff role (Option A)` | 9 |
| C6 | `test: QA harness and browser specs for the redesign, OG backlog, final QA and Option A` | 31 |
| C7 | `docs: implementation, QA, permission, release-readiness and staging documents` | 9 |

## C1 — docs: workspace audit and operational gap analysis

The Gate 1 workspace audit (7 docs, 2026-10-16) and the OG-01…OG-32 gap analysis. Documentation only.

<details><summary>8 files</summary>


- `docs/hellocircle-complete-operational-gap-analysis.md`
- `docs/workspace-audit.md`
- `docs/workspace-implementation-plan.md`
- `docs/workspace-information-architecture.md`
- `docs/workspace-page-inventory.md`
- `docs/workspace-permission-matrix.md`
- `docs/workspace-ux-ui-specification.md`
- `docs/workspace-workflow-matrix.md`

</details>

## C2 — feat: workspace redesign and OG-01…OG-32 operational backlog

Admin/partner/host workspace redesign (2026-10-14…16: cream shell, record pages, 8px radius and select tokens, page-by-page admin) and the OG-01…OG-32 implementation (stability, moderation, closures, admin invitations and MFA, operations directories, booking changes, partner customers/orders/statements, host series/approval/moderation, privacy requests). Additive schema only (7 tables, nullable/defaulted columns). New dependency otpauth@9.5.1. The two areas edit the same shared files (adminUi, ui, api modules, routes/admin) and cannot be split by file and still build.

<details><summary>238 files</summary>


- `README.md`
- `client/src/App.tsx`
- `client/src/DashboardNavContext.tsx`
- `client/src/api.ts`
- `client/src/api/admin.ts` (earlier version; this pass's edits are in C4)
- `client/src/api/adminAccess.ts`
- `client/src/api/core.ts`
- `client/src/api/public.ts`
- `client/src/api/resident.ts`
- `client/src/api/vendor.ts`
- `client/src/authRedirect.ts`
- `client/src/components/AccountSetupDialogs.tsx`
- `client/src/components/AccountSetupGate.tsx`
- `client/src/components/ActionMenu.tsx`
- `client/src/components/AddressSearch.tsx`
- `client/src/components/AdminCommerce.tsx`
- `client/src/components/AdminFinance.tsx`
- `client/src/components/AdminMedia.tsx`
- `client/src/components/AdminPolicy.tsx`
- `client/src/components/AuthForms.tsx`
- `client/src/components/AuthShell.tsx`
- `client/src/components/AvailabilityPicker.tsx`
- `client/src/components/BrowseLayout.tsx`
- `client/src/components/ChatModal.tsx`
- `client/src/components/CircleActivityCard.tsx`
- `client/src/components/CircleHighlightsCard.tsx`
- `client/src/components/CircleModerationTab.tsx`
- `client/src/components/CircleMoments.tsx`
- `client/src/components/ClubParticipantsTab.tsx`
- `client/src/components/DemandSignals.tsx`
- `client/src/components/DiscoveryMapImpl.tsx`
- `client/src/components/EarningsSummary.tsx`
- `client/src/components/FieldHelp.tsx`
- `client/src/components/FilterDropdown.tsx`
- `client/src/components/GameJoinCard.tsx`
- `client/src/components/GameLocationCard.tsx`
- `client/src/components/GameUpdates.tsx`
- `client/src/components/GuidedFlow.tsx`
- `client/src/components/Header.tsx`
- `client/src/components/HostActivitiesTab.tsx`
- `client/src/components/HostAttention.tsx`
- `client/src/components/HostCalendarTab.tsx`
- `client/src/components/HostChatButton.tsx`
- `client/src/components/HostCheckInScreen.tsx`
- `client/src/components/HostCirclesTab.tsx`
- `client/src/components/HostDashboardPanel.tsx`
- `client/src/components/HostEarningsTab.tsx`
- `client/src/components/HostInsightsTab.tsx`
- `client/src/components/HostOffersTab.tsx`
- `client/src/components/HostReservationsTab.tsx`
- `client/src/components/HostReviewsTab.tsx`
- `client/src/components/IntentCaptureForm.tsx`
- `client/src/components/MarketplaceHealth.tsx`
- `client/src/components/MonthCalendar.tsx`
- `client/src/components/MyLifeDiscoveryCTA.tsx`
- `client/src/components/MyLifeEmptyState.tsx`
- `client/src/components/MyLifeRepeatOpportunities.tsx`
- `client/src/components/MyLifeRhythm.tsx`
- `client/src/components/MyLifeSaved.tsx`
- `client/src/components/MyLifeThisMonth.tsx`
- `client/src/components/MyLifeWaitingFor.tsx`
- `client/src/components/NextStepsPanel.tsx`
- `client/src/components/PayoutHistory.tsx`
- `client/src/components/PhotoGallery.tsx`
- `client/src/components/PlanRewardsPanel.tsx`
- `client/src/components/PrivacyRequestRow.tsx` (earlier version; this pass's edits are in C4)
- `client/src/components/ReportContentButton.tsx`
- `client/src/components/SearchAlertsPanel.tsx`
- `client/src/components/SelfCancelControl.tsx`
- `client/src/components/SessionExpiryBanner.tsx`
- `client/src/components/ShareSheet.tsx`
- `client/src/components/SinglePinMap.tsx`
- `client/src/components/SinglePinMapImpl.tsx`
- `client/src/components/VendorAllOrders.tsx`
- `client/src/components/VendorAttention.tsx`
- `client/src/components/VendorBlockTimeDialog.tsx`
- `client/src/components/VendorBookings.tsx`
- `client/src/components/VendorCentreEditor.tsx`
- `client/src/components/VendorCheckInScreen.tsx`
- `client/src/components/VendorClubEditor.tsx`
- `client/src/components/VendorCustomers.tsx` (earlier version; this pass's edits are in C5)
- `client/src/components/VendorExperiences.tsx` (earlier version; this pass's edits are in C4)
- `client/src/components/VendorListings.tsx`
- `client/src/components/VendorMessages.tsx`
- `client/src/components/VendorOffers.tsx`
- `client/src/components/VendorOrg.tsx` (earlier version; this pass's edits are in C5)
- `client/src/components/VendorOverview.tsx`
- `client/src/components/VendorParticipationEditor.tsx`
- `client/src/components/VendorPrograms.tsx`
- `client/src/components/VendorReviews.tsx`
- `client/src/components/VendorSetupChecklist.tsx`
- `client/src/components/VendorStatementCard.tsx`
- `client/src/components/VenueSplitsCard.tsx`
- `client/src/components/admin/AdminAudit.tsx`
- `client/src/components/admin/AdminCoupons.tsx`
- `client/src/components/admin/AdminListings.tsx` (earlier version; this pass's edits are in C4)
- `client/src/components/admin/AdminMfa.tsx`
- `client/src/components/admin/AdminMisc.tsx`
- `client/src/components/admin/AdminOperations.tsx`
- `client/src/components/admin/AdminOverview.tsx`
- `client/src/components/admin/AdminPrivacy.tsx` (earlier version; this pass's edits are in C4)
- `client/src/components/admin/AdminQueues.tsx`
- `client/src/components/admin/AdminReviews.tsx`
- `client/src/components/admin/AdminSettings.tsx`
- `client/src/components/admin/AdminShell.tsx`
- `client/src/components/admin/AdminSupport.tsx`
- `client/src/components/admin/AdminTeamAccess.tsx`
- `client/src/components/admin/AdminVendors.tsx` (earlier version; this pass's edits are in C4)
- `client/src/components/admin/admin.css`
- `client/src/components/admin/adminHelpers.test.ts`
- `client/src/components/admin/adminNav.ts`
- `client/src/components/admin/adminUi.tsx` (earlier version; this pass's edits are in C4)
- `client/src/components/admin/auditFormat.ts`
- `client/src/components/admin/listingReview.ts`
- `client/src/components/admin/timeLabels.ts`
- `client/src/components/commerceMarkup.test.tsx`
- `client/src/components/ctaBand.css`
- `client/src/components/forVenues/ChooseYourPathSection.tsx`
- `client/src/components/forVenues/VendorFinalCTA.tsx`
- `client/src/components/form.tsx`
- `client/src/components/header/header.css`
- `client/src/components/helpGuide/GuideStep.tsx`
- `client/src/components/helpGuide/ScreenshotPlaceholder.tsx`
- `client/src/components/ui.tsx`
- `client/src/components/workspace/AttentionQueue.tsx`
- `client/src/components/workspace/BookingChangeParts.tsx`
- `client/src/components/workspace/ComplaintsAboutYou.tsx`
- `client/src/components/workspace/HostWorkspace.tsx`
- `client/src/components/workspace/ListingMeta.tsx`
- `client/src/components/workspace/OfferParts.tsx`
- `client/src/components/workspace/PartnerWorkspace.tsx`
- `client/src/components/workspace/PersonalAccountGate.tsx`
- `client/src/components/workspace/ReviewParts.tsx`
- `client/src/components/workspace/SectionCard.tsx`
- `client/src/components/workspace/WorkspaceShell.tsx`
- `client/src/components/workspace/WsListTable.tsx`
- `client/src/components/workspace/inWorkspace.ts`
- `client/src/components/workspace/sectionSave.ts`
- `client/src/index.css`
- `client/src/irelandDate.test.ts`
- `client/src/irelandDate.ts`
- `client/src/pageTitle.ts`
- `client/src/pages/AdminDashboard.tsx`
- `client/src/pages/AdminInviteAccept.tsx`
- `client/src/pages/AskHelloCircle.tsx`
- `client/src/pages/BookingChangePage.tsx`
- `client/src/pages/Browse.tsx`
- `client/src/pages/CentreDetail.tsx`
- `client/src/pages/Chats.tsx`
- `client/src/pages/CircleDetail.tsx`
- `client/src/pages/ClubDetail.tsx`
- `client/src/pages/CookiePolicy.tsx`
- `client/src/pages/ExperienceDetail.tsx`
- `client/src/pages/Explore.tsx`
- `client/src/pages/GameDetail.tsx`
- `client/src/pages/Games.tsx`
- `client/src/pages/HostGamePage.tsx`
- `client/src/pages/HostProfile.tsx`
- `client/src/pages/InvitationLanding.tsx`
- `client/src/pages/MakeItHappen.tsx`
- `client/src/pages/ManageCircle.tsx`
- `client/src/pages/ManageHome.tsx`
- `client/src/pages/MyBookings.tsx`
- `client/src/pages/Profile.tsx`
- `client/src/pages/ProgramDetail.tsx`
- `client/src/pages/SuggestPlace.tsx`
- `client/src/pages/VendorCentreEditPage.tsx`
- `client/src/pages/VendorClubEditPage.tsx`
- `client/src/pages/VendorDashboard.tsx` (earlier version; this pass's edits are in C5)
- `client/src/pages/VendorExperienceEditPage.tsx`
- `client/src/pages/VendorProgramEditPage.tsx`
- `client/src/pages/VendorSignup.tsx`
- `client/src/pages/helpGuide/HelpGuideIndex.tsx`
- `client/src/pages/helpGuide/HelpGuideShell.tsx`
- `client/src/pages/homeEditorial.css`
- `client/src/theme.ts`
- `client/src/vendorTabAccess.test.ts`
- `client/src/vendorTabAccess.ts`
- `package-lock.json`
- `packages/types/src/index.ts`
- `server/package.json`
- `server/src/adminDirectories.ts`
- `server/src/adminInvites.ts`
- `server/src/adminMfa.ts` (earlier version; this pass's edits are in C4)
- `server/src/adminPermissions.ts`
- `server/src/auth.ts`
- `server/src/bookingChanges.test.ts`
- `server/src/bookingChanges.ts`
- `server/src/bookingMove.ts`
- `server/src/db/index.ts`
- `server/src/financialExceptions.test.ts`
- `server/src/financialExceptions.ts`
- `server/src/hallBookingCancel.ts`
- `server/src/index.ts` (earlier version; this pass's edits are in C4)
- `server/src/moderationDecisions.ts`
- `server/src/notifications.ts`
- `server/src/privacyRequests.test.ts` (earlier version; this pass's edits are in C4)
- `server/src/privacyRequests.ts` (earlier version; this pass's edits are in C4)
- `server/src/reportModeration.test.ts`
- `server/src/reportModeration.ts`
- `server/src/routes/admin.ts` (earlier version; this pass's edits are in C4)
- `server/src/routes/adminAccess.test.ts`
- `server/src/routes/adminAccess.ts`
- `server/src/routes/adminFinance.ts`
- `server/src/routes/adminOperations.test.ts`
- `server/src/routes/adminOperations.ts`
- `server/src/routes/adminPaging.test.ts`
- `server/src/routes/adminPrivacy.ts`
- `server/src/routes/auth.ts`
- `server/src/routes/bookingChangeRoutes.ts`
- `server/src/routes/bookings.ts`
- `server/src/routes/chat.ts`
- `server/src/routes/circleModeration.test.ts`
- `server/src/routes/circles.ts`
- `server/src/routes/complaints.ts`
- `server/src/routes/complaintsSubject.test.ts`
- `server/src/routes/experienceDepartures.test.ts`
- `server/src/routes/experiences.ts`
- `server/src/routes/gameJoinApproval.test.ts`
- `server/src/routes/gameMove.test.ts`
- `server/src/routes/gameSeries.test.ts`
- `server/src/routes/games.ts`
- `server/src/routes/reports.test.ts`
- `server/src/routes/reports.ts`
- `server/src/routes/residents.ts`
- `server/src/routes/vendorAuthFlow.test.ts`
- `server/src/routes/vendorCustomers.test.ts`
- `server/src/routes/vendorExperiences.ts` (earlier version; this pass's edits are in C5)
- `server/src/routes/vendorHelpers.ts` (earlier version; this pass's edits are in C5)
- `server/src/routes/vendorInsights.ts` (earlier version; this pass's edits are in C5)
- `server/src/routes/vendorListings.ts`
- `server/src/routes/vendorOperations.ts` (earlier version; this pass's edits are in C5)
- `server/src/routes/vendorPrograms.ts` (earlier version; this pass's edits are in C5)
- `server/src/supportLookup.ts`
- `server/src/vendorStatements.test.ts`
- `server/src/vendorStatements.ts`
- `server/src/venueClosures.test.ts`
- `server/src/venueClosures.ts`

</details>

## C3 — feat(commerce): tell partners once about failed payouts and Pro past-due payments (OG-05)

Two notice hooks in payments/connect.ts and commerce/subscriptions.ts, called after the existing state change and never failing it. No fee, VAT, refund, payout, subscription or reward calculation is changed.

<details><summary>2 files</summary>


- `server/src/commerce/subscriptions.ts`
- `server/src/payments/connect.ts`

</details>

## C4 — fix: final QA pass — server-paged Vendors and All listings, erasure never 'completed', MFA key handling

OG-24 Vendors/All listings numbered server pages with counts, filters, sorts and record lookup; an erasure privacy request can't be marked completed while deletion is blocked (D-07/DEC-14); clear error on a changed MFA key and a boot-time key check that never prints the key; labelled departure inputs; tests adminListPages, adminMfaKey, privacy erasure.

<details><summary>15 files</summary>


- `client/src/api/admin.ts`
- `client/src/components/PrivacyRequestRow.tsx`
- `client/src/components/VendorExperiences.tsx`
- `client/src/components/admin/AdminListings.tsx`
- `client/src/components/admin/AdminPrivacy.tsx`
- `client/src/components/admin/AdminVendors.tsx`
- `client/src/components/admin/adminUi.tsx`
- `server/src/adminListPages.ts`
- `server/src/adminMfa.ts`
- `server/src/adminMfaKey.test.ts`
- `server/src/index.ts`
- `server/src/privacyRequests.test.ts`
- `server/src/privacyRequests.ts`
- `server/src/routes/admin.ts`
- `server/src/routes/adminListPages.test.ts`

</details>

## C5 — security: limit partner customer personal data by staff role (Option A)

Order records to managers + finance, listing rosters to managers, Customers to managers/finance/communications; read-only analysts get no customer names or emails (Overview without names, CSV without contact columns). Organisation scope unchanged. Test vendorPiiRoles (13).

<details><summary>9 files</summary>


- `client/src/components/VendorCustomers.tsx`
- `client/src/components/VendorOrg.tsx`
- `client/src/pages/VendorDashboard.tsx`
- `server/src/routes/vendorExperiences.ts`
- `server/src/routes/vendorHelpers.ts`
- `server/src/routes/vendorInsights.ts`
- `server/src/routes/vendorOperations.ts`
- `server/src/routes/vendorPiiRoles.test.ts`
- `server/src/routes/vendorPrograms.ts`

</details>

## C6 — test: QA harness and browser specs for the redesign, OG backlog, final QA and Option A

Spec updates for the redesigned screens, OG feature/responsive/isolation specs, OG-01/13/15/19/24 specs, PII role and browser specs, SANDBOX-SPLIT isolation guard, QA seed (MFA off in QA), run.ts batches.

<details><summary>31 files</summary>


- `tests/fixtures/browser.ts`
- `tests/integration/lifecycle-ui-fixture.ts`
- `tests/integration/pii-fixture.ts`
- `tests/integration/run.ts`
- `tests/integration/seed.ts`
- `tests/integration/specs/hc-completion-a.spec.ts`
- `tests/integration/specs/hc-completion-c.spec.ts`
- `tests/integration/specs/hc-completion-d.spec.ts`
- `tests/integration/specs/hc-d03-ui.spec.ts`
- `tests/integration/specs/hc-og-features-ui.spec.ts`
- `tests/integration/specs/hc-og-isolation.spec.ts`
- `tests/integration/specs/hc-og-responsive.spec.ts`
- `tests/integration/specs/hc-og01-switch.spec.ts`
- `tests/integration/specs/hc-og13-orders.spec.ts`
- `tests/integration/specs/hc-og15-24-admin.spec.ts`
- `tests/integration/specs/hc-og19-departures.spec.ts`
- `tests/integration/specs/hc-pii-roles.spec.ts`
- `tests/integration/specs/hc-pii-ui.spec.ts`
- `tests/integration/specs/hc-validation-ux.spec.ts`
- `tests/integration/specs/product-a11y-a.spec.ts`
- `tests/integration/specs/product-a11y-b.spec.ts`
- `tests/integration/specs/product-host.spec.ts`
- `tests/integration/specs/product-p13-a.spec.ts`
- `tests/integration/specs/product-vendor.spec.ts`
- `tests/integration/specs/revenue-admin-b.spec.ts`
- `tests/integration/specs/revenue-admin.spec.ts`
- `tests/integration/specs/revenue-partner.spec.ts`
- `tests/integration/specs/revenue-plan.spec.ts`
- `tests/integration/specs/revenue-resident.spec.ts`
- `tests/integration/specs/stripe-sandbox-split.spec.ts`
- `tests/smoke/application.spec.ts`

</details>

## C7 — docs: implementation, QA, permission, release-readiness and staging documents

The seven OG documents, the staging deployment checklist and this commit plan.

<details><summary>9 files</summary>


- `docs/hellocircle-commit-plan.md`
- `docs/hellocircle-final-page-inventory.md`
- `docs/hellocircle-implementation-summary.md`
- `docs/hellocircle-implementation-tracker.md`
- `docs/hellocircle-qa-results.md`
- `docs/hellocircle-release-readiness.md`
- `docs/hellocircle-remaining-decisions.md`
- `docs/hellocircle-role-permission-matrix.md`
- `docs/hellocircle-staging-deployment-checklist.md`

</details>
