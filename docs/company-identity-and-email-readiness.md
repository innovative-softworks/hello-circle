# Company identity & email readiness

**Date:** 2026-10-12. **Branch:** `feature/commerce-engine` (uncommitted). **Scope:** About, Contact, footer, the Policy CMS company profile, and outgoing email. No payment, Stripe, VAT, commercial-rule or production-data changes. Nothing is published, committed or deployed.

## 1. Owner decisions recorded (2026-10-12)

| Item | Decision | Where it's applied |
|---|---|---|
| Legal operator | **Innovative Softworks Technologies Limited** operates HelloCircle. **iSoftworks** is the corporate brand; **HelloCircle** is a product brand, not a separate company. | `server/src/companyIdentity.ts`, `client/src/companyDetails.ts` (`LEGAL_OPERATOR`); About, Contact, footer, email footer, site JSON-LD (`parentOrganization`) |
| CRO number, VAT status | Pending. The owner will supply verified values. Nothing guessed or website-derived. | Not shown publicly; admin checklist marks **Pending** |
| Registered office | Pending until confirmed from the CRO record. | Not shown publicly; checklist **Pending** |
| Trading name | Pending. HelloCircle isn't presented as a registered trading name. | Not shown publicly; checklist warns not to enter it yet |
| Customer support | `support@hellocircle.ie` | Contact page, footer "Contact us" route, sign-in email reply-to |
| Partnerships | `partners@hellocircle.ie` | Contact page, venue pages |
| Legal and privacy contacts | Pending. | Contact page says a privacy contact will be listed once confirmed; support@ is **not** shown as the privacy contact |
| Email sender | Preference: a verified `@hellocircle.ie` sender. Configuration unchanged for now. | Section 3 below |
| Legal publishing | All policies stay draft; no bypass of approval and solicitor sign-off. | Unchanged workflow |

## 2. How public company details are controlled

- **Operator name:** shown everywhere, from the single confirmed constant.
- **Every other legal detail** (trading name, registered office, CRO, VAT, phone, legal and privacy emails) is shown only when its exact value appears in a **published** policy. Publishing already requires review, approval, a named legal sign-off and every placeholder filled. If a value changes later, it stops showing until a policy carrying the new value is published.
- `GET /api/policies/company` returns only those approved fields. Today that's `{}`, because nothing is published.
- **Admin → Policies & trust → Company details → Company profile checklist** shows each field as Missing, Set but not yet published, or Published. It also shows the recorded decision and flags any value that differs from the confirmed one (e.g. a wrong legal name).

## 3. Email configuration checklist (support@ and partners@hellocircle.ie)

### What's configured today (verified)

| Area | Finding |
|---|---|
| App code | One global sender: `MAIL_FROM` (falls back to `SMTP_USER`) over SMTP via nodemailer, in 12 modules covering about 25 email types. **Reply-To is set on only one email** (resident sign-in, `support@hellocircle.ie`). `partners@hellocircle.ie` isn't used by any outgoing email. |
| Local dev `.env` | `MAIL_FROM` is an `@isoftworks.eu` address; the SMTP host is Gmail. (Only key names and domains were read, no secrets.) |
| Production | **Not inspected.** A check on 2026-10-08 recorded that SMTP is set; the sender address in use is unknown. |
| `hellocircle.ie` DNS | MX: Google Workspace ✓ · SPF `v=spf1 include:_spf.google.com ~all` ✓ · DKIM key at `google._domainkey` ✓ · DMARC `p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net` ✓ |
| `isoftworks.eu` DNS (current sender domain) | SPF only. **No DKIM at the common key names and no DMARC record**, so customer mail sent as `@isoftworks.eu` is more likely to land in spam. It also doesn't match the product brand. |
| Inbox delivery | **Not tested.** DNS shows the domain *can* receive mail. Whether the `support@` and `partners@` mailboxes or groups exist and are monitored needs a real test message. |

### Steps (owner or Workspace admin first; app config only once approved)

**A. Mailboxes (Google Workspace for hellocircle.ie)**
1. Create or confirm `support@hellocircle.ie` (mailbox or group) and name who monitors it.
2. Create or confirm `partners@hellocircle.ie` and name who monitors it.
3. Choose the sending identity, e.g. `notifications@hellocircle.ie` or `hello@hellocircle.ie`. Don't send as `support@` unless replies there are watched.
4. For that account, turn on 2-Step Verification and create an App Password, **or** use Workspace SMTP relay (`smtp-relay.gmail.com`) with the server IP allow-listed.

**B. DNS (mostly done; confirm)**
5. SPF is correct for Google sending. Add anything else that will send as hellocircle.ie.
6. In Workspace Admin → Apps → Gmail → Authenticate email, confirm DKIM signing is **started** for hellocircle.ie and matches the published `google._domainkey` key.
7. DMARC reports go to `dmarc_rua@onsecureserver.net` (likely the registrar's service). Confirm who reads them, and consider adding a hellocircle.ie report address.

**C. App configuration (later, on approval; not changed now)**
8. Production `server/.env`: `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_USER=<sending account>`, `SMTP_PASS=<app password>`, `MAIL_FROM="HelloCircle <notifications@hellocircle.ie>"`.
9. Staging keeps a separate, clearly labelled sender (per `deploy/staging/server.env.template`), never the production one.
10. Small code follow-up (needs approval): set Reply-To per audience. Customer emails go to `support@`. Partner and vendor emails (new-booking notices, account approval, organisation invites, application received) go to `partners@`. Admin alerts stay as they are.
11. Content follow-up (separate change): many email subjects still say "Hello Circle" (two words). `pricing.ts` also uses that spelling in Stripe product names; those stay as they are and need their own review.

**D. Verification (a person must do these)**
12. From an outside account, email `support@` and `partners@`; confirm both arrive and who answers.
13. After switching the sender, trigger a sign-in link, a booking confirmation and a vendor approval to Gmail and Outlook test inboxes. In "Show original", check SPF, DKIM and DMARC all **pass** and that nothing lands in spam.
14. Reply to one of those emails and confirm the reply reaches the intended inbox.
15. Watch DMARC reports for a week after the switch.

## 4. Information needed before any policy can be published

Publishing is refused while any placeholder a document uses is empty, or any `[editorial note]` remains. All 18 documents are drafts.

**Company and contact values** (Admin → Policies & trust → Company details):

| Placeholder | Used in | Status |
|---|---|---|
| `LEGAL_ENTITY_NAME` | 14 docs | Confirmed: enter **Innovative Softworks Technologies Limited** exactly |
| `REGISTERED_ADDRESS` | 14 | Owner to supply from CRO record |
| `COMPANY_NUMBER` | 13 | Owner to supply (verified CRO number) |
| `TRADING_NAME` | 13 | Decision needed (see below) |
| `SUPPORT_EMAIL` | 14 | Decided: `support@hellocircle.ie` (enter it) |
| `LEGAL_EMAIL` | 13 | Owner to decide |
| `PHONE_NUMBER` | 13 | Owner to decide whether to publish one |
| `PRIVACY_EMAIL` | 2 | Owner to decide |
| `GOVERNING_LAW` | 4 | Owner/solicitor (presumably Ireland) |
| `COURT_JURISDICTION` | 3 | Owner/solicitor |
| `MINIMUM_USER_AGE` | 1 | Owner/solicitor |
| `DATA_RETENTION_PERIOD` | 1 | Owner/solicitor |
| `VAT_NUMBER` | 0 docs today (in the mandatory list) | Owner to supply VAT number or confirm not registered |
| `STRIPE_ACCOUNT_COUNTRY` | 0 docs today (in the mandatory list) | Owner (relates to the paid launch, out of scope here) |

**Trading-name wording:** 13 drafts say "[[LEGAL_ENTITY_NAME]] (trading as [[TRADING_NAME]])". Since HelloCircle isn't a confirmed registered trading name, the solicitor should either confirm a registered business name, or change that sentence (e.g. "operator of the HelloCircle service"). The drafts haven't been edited.

**Editorial notes the solicitor must resolve:**
- general-terms: platform liability limits clause
- customer-booking-terms: consumer-law clause, incl. the 14-day withdrawal exception for dated leisure services
- vendor-venue-agreement: notice period
- cancellation-refunds: consumer-law clause
- complaints-appeals: time limit ("6 months"), list of bodies, response time
- dac7-seller-notice: Revenue Commissioners wording; exemptions and thresholds
- accessibility-statement: issues list from an accessibility audit; response time; date

**Then, per document:** submit → approve (a second admin if required) → record the named legal reviewer's sign-off → publish.
