# HelloCircle — global UX/UI tracker

_2026-10-20. Every real route and sub-section, discovered from the code: admin `adminNav.ts`, partner `VENDOR_TABS`, host `HOST_TABS`, sub-section URL params, `App.tsx` routes and the record pages. Local, uncommitted._

- **Responsive:** checked automatically at 10 widths (320, 375, 390, 428, 768, 900, 1024, 1280, 1440, 1920) for sideways scroll, controls cut off at the edge, page errors, unlabelled buttons, images without alt text and tap targets under 24px at phone widths. Screenshots were taken at 390, 1024 and 1440.
- **Functional QA:** the real-stack browser suites (validation, product, lifecycle, authorization, booking) run on a fresh QA database; results are in `hellocircle-global-ux-ui-qa.md`.
- **Verified:** the page is clean at all 10 widths and the suites passed. **Implemented:** changed, but not every check passed.

| Workspace | Route | Page type | UX issues found | UI changes | Responsive (10 widths) | Functional QA | Status |
|---|---|---|---|---|---|---|---|
| Admin | `/admin` | A Dashboard | Decisions first; metric cards were separate boxes | Attention row as one strip with tinted icons; queue and activity as divided sections | Clean (4 inline links under 24px; WCAG inline exception) | Suites pass | Verified |
| Admin | `/admin?tab=pending` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=support` | B Directory | Boxed table section | Divided section, quiet row actions, ⋯ row menu | Clean | Suites pass | Verified |
| Admin | `/admin?tab=exceptions` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=people` | B Directory | Section repeated the page title and description; bordered Open per row | Duplicate heading/description removed; quiet Open + ⋯ menu; denser rows | Clean | Suites pass | Verified |
| Admin | `/admin?tab=orders` | B Directory | Duplicate heading; bordered row buttons | Duplicate heading removed; quiet Open + ⋯ (copy reference) | Clean | Suites pass | Verified |
| Admin | `/admin?tab=activities` | B Directory | Duplicate heading | Duplicate heading removed; ⋯ menu | Clean | Suites pass | Verified |
| Admin | `/admin?tab=circles` | B Directory | Duplicate heading | Duplicate heading removed; ⋯ (copy link) | Clean | Suites pass | Verified |
| Admin | `/admin?tab=hosts` | B Directory | Duplicate heading | Duplicate heading removed; ⋯ (copy email) | Clean | Suites pass | Verified |
| Admin | `/admin?tab=listings` | B Directory | — | Photo collection kept (fits venues); framed parts flattened | Clean | Suites pass | Verified |
| Admin | `/admin?tab=vendors` | B Directory | No bulk approval; row actions only Open | Checkboxes + Approve N for pending accounts; ⋯ (approve, open in Support, copy email) | Clean | Suites pass | Verified |
| Admin | `/admin?tab=claims` | B Directory | One-by-one decisions only | Checkboxes + Approve N; ⋯ menu | Clean | Suites pass | Verified |
| Admin | `/admin?tab=hostApplications` | B Directory | One-by-one decisions only | Checkboxes + Approve N; ⋯ menu | Clean | Suites pass | Verified |
| Admin | `/admin?tab=placeSuggestions` | B Directory | One-by-one decisions only | Checkboxes + Approve & publish N; ⋯ menu | Clean | Suites pass | Verified |
| Admin | `/admin?tab=organisations` | B Directory | Boxed table section | Divided section, quiet row actions, ⋯ row menu | Clean (4 inline links under 24px; WCAG inline exception) | Suites pass | Verified |
| Admin | `/admin?tab=marketplaceHealth` | A Dashboard | Double divider lines between legacy sections | Single divider per section | Clean | Suites pass | Verified |
| Admin | `/admin?tab=marketplaceHealth&section=demand` | A Dashboard | Card-heavy summary | Key-numbers strip, divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=coupons` | B Directory | Section repeated the page title | Duplicate heading removed | Clean (1 inline link under 24px; WCAG inline exception) | Suites pass | Verified |
| Admin | `/admin?tab=coupons&section=usage` | B Directory | Boxed table section | Divided section, quiet row actions, ⋯ row menu | Clean (1 inline link under 24px; WCAG inline exception) | Suites pass | Verified |
| Admin | `/admin?tab=commerce&section=switches` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=commerce&section=pro` | F Settings | White framed list | Divided rows on the page background | Clean | Suites pass | Verified |
| Admin | `/admin?tab=commerce&section=rewards` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=commerce&section=credit` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=commerce&section=coupons` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=commerce&section=tax` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=commerce&section=help` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=commerce&section=other` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=commerce&section=history` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=overview` | A Dashboard | Tabs wrapped to two lines | Tighter tabs; rows in finance tables get ⋯ menus | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=reviews` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=disputes` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=events` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=refunds` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=settlements` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=transfers` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=payouts` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=debts` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=plansCredit&section=credits` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=plansCredit&section=rewards` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=plansCredit&section=plans` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=plansCredit&section=simulator` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=reviews` | E Operational | Row-by-row hide/dismiss only | Bulk hide/unhide reviews and bulk dismiss reports; ⋯ menus | Clean | Suites pass | Verified |
| Admin | `/admin?tab=policies&section=documents` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=policies&section=values` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=policies&section=complaints` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=policies&section=traders` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=audit` | B Directory | Boxed table section | Divided section, quiet row actions, ⋯ row menu | Clean (13 inline links under 24px; WCAG inline exception) | Suites pass | Verified |
| Admin | `/admin?tab=notificationTemplates` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=privacy` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=privacy&section=consents` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Admin | `/admin?tab=media` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=settings&section=status` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=settings&section=roles` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=settings&section=help` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=settings&section=market` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Admin | `/admin?tab=settings&section=weights` | F Settings | Boxed panels | Divided sections | Clean (1 inline link under 24px; WCAG inline exception) | Suites pass | Verified |
| Partner | `/vendor` | A Dashboard | Decisions first; metric cards were separate boxes | Attention row as one strip with tinted icons; queue and activity as divided sections | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=schedule` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=bookings` | E Operational | Filter bar indented 24px | Filter bar aligned with page | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=customers` | B Directory | No row options | ⋯ (open, email, copy email) | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=messages` | E Operational | Only 'Mark all read' | Select notifications + Mark N read; ⋯ (open, mark read, copy ref) | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=listings` | B Directory | — | Photo collection kept (fits venues); framed parts flattened | Clean (2 inline links under 24px; WCAG inline exception) | Suites pass | Verified |
| Partner | `/vendor?tab=programs` | B Directory | Boxed table section | Divided section, quiet row actions, ⋯ row menu | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=experiences` | B Directory | Boxed table section | Divided section, quiet row actions, ⋯ row menu | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=earnings` | A Dashboard | Card tiles; tiny help icons | Tiles as a strip with tinted icons; help icon 26px hit area | Clean (4 inline links under 24px; WCAG inline exception) | Suites pass | Verified |
| Partner | `/vendor?tab=offers` | B Directory | Boxed table section | Divided section, quiet row actions, ⋯ row menu | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=reviews` | E Operational | Row-by-row hide/dismiss only | Bulk hide/unhide reviews and bulk dismiss reports; ⋯ menus | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=demand` | A Dashboard | Card-heavy summary | Key-numbers strip, divided sections | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=org&section=settings` | F Settings | Inputs stretched ~1050px wide | Settings template: group title left, fields in a 680px column | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=org&section=trader` | F Settings | Inputs stretched full width | Settings template layout | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=org&section=staff` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=org&section=participants` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=org&section=insights` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Partner | `/vendor/centres/new` | D Form | Card grid sections | Rule-separated sections; readiness in the context column | Clean | Suites pass | Verified |
| Partner | `/vendor/pro` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Partner | `/vendor/rewards` | B Directory | Boxed table section | Divided section, quiet row actions, ⋯ row menu | Clean (3 inline links under 24px; WCAG inline exception) | Suites pass | Verified |
| Host | `/manage` | A Dashboard | Decisions first; metric cards were separate boxes | Attention row as one strip with tinted icons; queue and activity as divided sections | Clean | Suites pass | Verified |
| Host | `/manage?tab=activities` | B Directory | Duplicate heading | Duplicate heading removed; ⋯ menu | Clean (1 inline link under 24px; WCAG inline exception) | Suites pass | Verified |
| Host | `/manage?tab=reservations` | B Directory | Boxed table section | Divided section, quiet row actions, ⋯ row menu | Clean | Suites pass | Verified |
| Host | `/manage?tab=calendar` | E Operational | Boxed panels | Divided sections; ⋯ row menus; bulk actions where a real action exists | Clean | Suites pass | Verified |
| Host | `/manage?tab=circles` | B Directory | Duplicate heading | Duplicate heading removed; ⋯ (copy link) | Clean | Suites pass | Verified |
| Host | `/manage?tab=insights` | A Dashboard | Card-heavy summary | Key-numbers strip, divided sections | Clean | Suites pass | Verified |
| Host | `/manage?tab=earnings` | A Dashboard | Card tiles; tiny help icons | Tiles as a strip with tinted icons; help icon 26px hit area | Clean (4 inline links under 24px; WCAG inline exception) | Suites pass | Verified |
| Host | `/manage?tab=reviews` | E Operational | Row-by-row hide/dismiss only | Bulk hide/unhide reviews and bulk dismiss reports; ⋯ menus | Clean | Suites pass | Verified |
| Host | `/manage?tab=offers` | B Directory | Boxed table section | Divided section, quiet row actions, ⋯ row menu | Clean | Suites pass | Verified |
| Host | `/games/host?from=manage` | D Form | Card grid sections | Rule-separated sections; readiness in the context column | Clean | Suites pass | Verified |
| Host | `/manage/pro` | F Settings | Boxed panels | Divided sections | Clean | Suites pass | Verified |
| Host | `/manage/rewards` | B Directory | Boxed table section | Divided section, quiet row actions, ⋯ row menu | Clean (3 inline links under 24px; WCAG inline exception) | Suites pass | Verified |
| Host | `/manage/circles/sunday-pier-walkers?tab=members` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean (1 inline link under 24px; WCAG inline exception) | Suites pass | Verified |
| Host | `/manage/circles/sunday-pier-walkers?tab=moderation` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Host | `/manage/circles/sunday-pier-walkers?tab=settings` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=listings&record=centre:c11` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean (1 inline link under 24px; WCAG inline exception) | Suites pass | Verified |
| Admin | `/admin?tab=pending&record=club:2378828f-6195-4642-bac1-5262a55e41af` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean (1 inline link under 24px; WCAG inline exception) | Suites pass | Verified |
| Admin | `/admin?tab=vendors&record=33c1128a-b1d3-4318-83ec-51a740a5f77a` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=organisations&record=org:275379d6-0797-4f41-a64e-463f50187bb1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=support&record=person:aine.whelan.19@hellocircle-demo.ie` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=support&record=order:booking:DEMO-HUB-1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=activities&record=activity:bb0309e8-8e65-4482-9385-fa212a671aa5` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=claims&record=claim:1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=hostApplications&record=host:demo-resident-19` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=placeSuggestions&record=suggestion:demo-place-1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=reviews&record=report:1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=privacy&record=privacy:1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=settlements&record=settlement:1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=transfers&record=transfer:1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=refunds&record=refund:1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=disputes&record=dispute:1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=reviews&record=review:1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=events&record=event:25` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean after fix (main audit: 10px sideways scroll at 320; long title now wraps; recheck clean at all 10 widths) | Suites pass | Verified |
| Admin | `/admin?tab=finance&section=refunds&record=order:booking:DEMO-HUB-1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=bookings&record=booking:DEMO-HUB-1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=customers&record=customer:aoife.byrne@example.test` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Partner | `/vendor?tab=org&section=staff&record=member:qa-review-staff-1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Partner | `/vendor/centres/98671ace-1b51-4c16-a987-44fbae0d7825` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean (3 inline links under 24px; WCAG inline exception) | Suites pass | Verified |
| Partner | `/vendor/clubs/2378828f-6195-4642-bac1-5262a55e41af` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean (4 inline links under 24px; WCAG inline exception) | Suites pass | Verified |
| Partner | `/vendor/programs/demo-prog-yoga` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Partner | `/vendor/experiences/demo-experience-1` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean (2 inline links under 24px; WCAG inline exception) | Suites pass | Verified |
| Host | `/manage?tab=activities&record=activity:bb0309e8-8e65-4482-9385-fa212a671aa5` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Host | `/manage/circles/sunday-pier-walkers` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean | Suites pass | Verified |
| Host | `/manage/circles/sunday-pier-walkers?tab=members` | C Record | Boxed side column; repeated facts | 70/30 template: key numbers, sections with dividers, full-height lighter context column | Clean (1 inline link under 24px; WCAG inline exception) | Suites pass | Verified |

**Totals:** 120 page views — Verified 120.

## Not built (need backend work and approval)

| Workspace | Page | Why |
|---|---|---|
| Admin | Circle details | No admin Circle record or read API; the list opens the public Circle page |
| Host | Participant details | Participants are rows on the activity page; no participant record or API |
| Host | Reservation details | A reservation opens its activity's record page |
| Partner/Host | Occupancy, dashboard earnings summary | No stored occupancy figure; the balance tiles only move once the Financial ledger switch is on |
