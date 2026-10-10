// Revenue & Connect Stage 4 — the 18 policy documents, seeded once as
// STRUCTURED DRAFTS (headings, clauses, placeholders): a starting point for a
// solicitor, not final legal text. Every one starts as version 1 in "draft"
// and cannot be published while a [[PLACEHOLDER]] remains or before a legal
// reviewer signs it off (see cms.ts). Rates are never written into a policy:
// fee clauses point at the Pricing page, which reads the published rules, so
// a policy can't drift out of step with what checkout actually charges.
//
// Markdown subset understood by the client renderer: # / ## / ### headings,
// paragraphs, "- " bullets, "1. " numbered items, **bold**, [text](url).

export type PolicyAudience = "everyone" | "customers" | "partners" | "hosts";
/** Who must accept the document before using the matching surface. */
export type AcceptanceAudience = "partner" | "host" | "resident" | null;

export interface PolicySeed {
  key: string;
  title: string;
  audience: PolicyAudience;
  acceptance: AcceptanceAudience;
  sort: number;
  body: string;
}

const CONTACT = `## Contact

[[LEGAL_ENTITY_NAME]] (trading as [[TRADING_NAME]]), company number [[COMPANY_NUMBER]], registered office [[REGISTERED_ADDRESS]].
Support: [[SUPPORT_EMAIL]] · Legal: [[LEGAL_EMAIL]] · Phone: [[PHONE_NUMBER]]`;

const LAW = `## Governing law

These terms are governed by the laws of [[GOVERNING_LAW]]. The courts of [[COURT_JURISDICTION]] have jurisdiction, without removing any mandatory protection you have as a consumer where you live.`;

export const POLICY_SEEDS: PolicySeed[] = [
  {
    key: "general-terms",
    title: "General Terms",
    audience: "everyone",
    acceptance: "resident",
    sort: 1,
    body: `# General Terms

## 1. About these terms

1. These terms apply to everyone who uses HelloCircle, the website and apps operated by [[LEGAL_ENTITY_NAME]] ("HelloCircle", "we").
2. Additional terms apply to specific activities: the [Customer Booking Terms](/policies/customer-booking-terms) when you book, the [Vendor & Venue Agreement](/policies/vendor-venue-agreement) or [Host Agreement](/policies/host-agreement) when you offer activities, and the other policies linked from the [Policy Centre](/policies).

## 2. What HelloCircle is

1. HelloCircle is an online marketplace. Venues, clubs, organisations and hosts ("partners") list activities; customers book them.
2. The partner named on a listing supplies the activity and is responsible for delivering it. HelloCircle takes payment on the partner's behalf and passes it on under the [Payments, Fees & Payout Policy](/policies/payments-fees-payouts).

## 3. Accounts

1. You must be at least [[MINIMUM_USER_AGE]] to create an account. A parent or guardian books on behalf of a child.
2. Keep your sign-in details secure. You are responsible for activity on your account.
3. Give accurate information and keep it up to date.

## 4. Using HelloCircle

1. Follow the [Community & Safety Standards](/policies/community-safety) and the [Acceptable Use Policy](/policies/acceptable-use).
2. We may remove content or restrict accounts that break these terms. We give reasons and you can appeal — see [Complaints, Moderation & Appeals](/policies/complaints-appeals).

## 5. Liability

1. Nothing in these terms limits liability that cannot be limited by law, including your statutory rights as a consumer.
2. [Clause on platform liability limits — legal review required.]

## 6. Changes

1. We may update these terms. For material changes we give notice and, where required, ask you to accept the new version before you continue.

${LAW}

${CONTACT}`,
  },
  {
    key: "customer-booking-terms",
    title: "Customer Booking Terms",
    audience: "customers",
    acceptance: null,
    sort: 2,
    body: `# Customer Booking Terms

## 1. Your booking

1. When you book, your contract for the activity is with the partner named on the listing and at checkout. HelloCircle is not the supplier of the activity.
2. The price shown at checkout is the price you pay. HelloCircle adds no booking fee for customers.
3. Your confirmation and receipt name the partner, the activity, the date and the amount paid.

## 2. Payment

1. Payment is taken by HelloCircle's payment provider (Stripe) on behalf of the partner. Card details are handled by Stripe and are never stored by HelloCircle.
2. A booking is confirmed only once payment succeeds.

## 3. Cancellations and refunds

1. Cancellation, refund and no-show rules are set out in the [Cancellation, Refund & No-show Policy](/policies/cancellation-refunds) and on the listing at the time you book.
2. If a partner cancels, you receive a full refund.

## 4. Coupons, credits and rewards

1. Coupons, credits and rewards are subject to their own terms: [Coupon & Promotion Terms](/policies/coupon-promotion-terms), [Credits & Wallet Terms](/policies/credits-wallet-terms) and [Rewards Terms](/policies/rewards-terms).

## 5. Your statutory rights

1. [Consumer-law clause, including the exception from the 14-day withdrawal right for leisure services on a specific date — legal review required.]

## 6. Problems with an activity

1. Contact the partner first. If it is not resolved, contact [[SUPPORT_EMAIL]] or use the [complaints form](/complaints).

${CONTACT}`,
  },
  {
    key: "vendor-venue-agreement",
    title: "Vendor & Venue Agreement",
    audience: "partners",
    acceptance: "partner",
    sort: 3,
    body: `# Vendor & Venue Agreement

## 1. Parties

1. This agreement is between [[LEGAL_ENTITY_NAME]] and the organisation that lists venues, clubs, programmes or experiences on HelloCircle ("you").

## 2. Your listings

1. You supply the activity described in your listing and are responsible for delivering it safely, lawfully and as described.
2. Keep listings accurate: prices, availability, capacity, accessibility, age limits and safety information.
3. You must complete trader verification before selling paid activities — see the [Trader Verification Policy](/policies/trader-verification).

## 3. Fees and payouts

1. HelloCircle charges the success fee for your plan, as published on the [Pricing page](/pricing), plus VAT on that fee. Your customers pay no booking fee.
2. Payouts follow the [Payments, Fees & Payout Policy](/policies/payments-fees-payouts).
3. A Pro subscription is optional and subject to the [Pro Subscription Terms](/policies/pro-subscription-terms).

## 4. Tax

1. You are responsible for VAT and other taxes on your own activities.
2. We collect and may report seller information as required by DAC7 — see the [DAC7 Seller Notice](/policies/dac7-seller-notice).

## 5. Insurance, safety and safeguarding

1. Hold insurance appropriate to your activities, and give us evidence on request.
2. Where your activities involve children, follow applicable safeguarding requirements.

## 6. Refunds, disputes and chargebacks

1. You honour the cancellation policy shown on your listing.
2. If a payment dispute is lost because of your activity (for example, it did not take place), the amount may be recovered from your balance, as described in the Payments policy.

## 7. Suspension and termination

1. We may suspend listings or payouts where there is a serious risk, a legal requirement, or a material breach. We give a statement of reasons, and you can appeal.
2. Either party may end this agreement with [notice period — legal review required].

${LAW}

${CONTACT}`,
  },
  {
    key: "host-agreement",
    title: "Host Agreement",
    audience: "hosts",
    acceptance: "host",
    sort: 4,
    body: `# Host Agreement

## 1. Who this is for

1. This agreement applies to individuals who host games, sessions or circles on HelloCircle ("hosts").

## 2. Hosting

1. You organise and run the sessions you host, and must describe them accurately.
2. Paid sessions require a verified host profile and completed trader details.
3. Where a session uses a venue, the venue's own terms and any agreed venue/host split also apply.

## 3. Fees and payouts

1. The success fee for your plan, as published on the [Pricing page](/pricing), plus VAT on that fee, is deducted from what customers pay. Payouts follow the [Payments, Fees & Payout Policy](/policies/payments-fees-payouts).

## 4. Safety

1. Follow the [Community & Safety Standards](/policies/community-safety).

## 5. Tax

1. Hosts who sell activities may be "sellers" for DAC7 purposes — see the [DAC7 Seller Notice](/policies/dac7-seller-notice). You are responsible for your own tax affairs.

${LAW}

${CONTACT}`,
  },
  {
    key: "payments-fees-payouts",
    title: "Payments, Fees & Payout Policy",
    audience: "partners",
    acceptance: "partner",
    sort: 5,
    body: `# Payments, Fees & Payout Policy

## 1. How payments work

1. Customers pay HelloCircle through Stripe. HelloCircle collects the payment on the partner's behalf.
2. Funds are held in HelloCircle's Stripe account until the order is eligible for transfer. Delayed transfer is not escrow, and funds are not safeguarded or held in trust.

## 2. Fees

1. HelloCircle charges a success fee on each completed paid order. The rate and the minimum fee per paid order depend on your plan and are published on the [Pricing page](/pricing). No fee is charged on free events.
2. The fee is calculated on the fee base: the activity price after any discount you fund, less anything refunded.
3. VAT on HelloCircle's fee is charged at the applicable rate and deducted from your payout. VAT on your own activity remains your responsibility.
4. Standard card processing and standard payouts are included in the success fee. Optional services (such as instant payouts, currency conversion or cross-border payouts) are charged at cost where offered.

## 3. When you get paid

1. Transfer eligibility begins after the activity is completed and the review period has passed.
2. Payouts are made weekly. Balances below the minimum payout carry forward to the next week.
3. You need a connected payout account that has completed Stripe's verification before payouts can be made.

## 4. Refunds after payout

1. If an order is refunded after you have been paid, the refunded share is deducted from your future balance. Your balance may be negative until it is recovered.

## 5. Disputes and chargebacks

1. If a customer disputes a payment, we may hold the related amount while the dispute is open.
2. If a dispute is lost for a reason caused by your activity, the amount is recovered from your balance. If it was caused by HelloCircle, HelloCircle bears it.

## 6. Statements

1. Your dashboard shows pending, available and settled amounts, and every fee deducted.

${CONTACT}`,
  },
  {
    key: "cancellation-refunds",
    title: "Cancellation, Refund & No-show Policy",
    audience: "everyone",
    acceptance: null,
    sort: 6,
    body: `# Cancellation, Refund & No-show Policy

## 1. Customer cancellations

1. Each listing shows its cancellation window at the time of booking. Cancelling within the window gives a full refund unless the listing states otherwise.
2. Late cancellations and no-shows are handled under the listing's stated rules.

## 2. Partner cancellations

1. If a partner cancels, the customer receives a full refund. Repeated cancellations may lead to action under the partner agreement.

## 3. Partial refunds

1. A partner or HelloCircle may issue a partial refund. Fees are recalculated on the amount the customer keeps paying for.

## 4. How refunds are paid

1. Refunds go back to the original payment method. Bank processing times vary.

## 5. Statutory rights

1. [Consumer-law clause — legal review required.]

${CONTACT}`,
  },
  {
    key: "pro-subscription-terms",
    title: "Pro Subscription Terms",
    audience: "partners",
    acceptance: null,
    sort: 7,
    body: `# Pro Subscription Terms

## 1. The subscription

1. Pro is an optional monthly subscription for partners. The price and the reduced success fee are published on the [Pricing page](/pricing). VAT applies to the subscription.

## 2. Billing

1. Pro is billed monthly in advance through Stripe Billing and renews automatically until cancelled.
2. If a payment fails, we retry. If it still fails, the account returns to the Free plan.

## 3. Changing plan

1. You can cancel at any time. Pro continues until the end of the paid month.
2. Orders keep the fee terms that applied when they were placed.

## 4. Promotions

1. Promotional Pro periods are subject to the campaign terms shown when you enrol.

${CONTACT}`,
  },
  {
    key: "coupon-promotion-terms",
    title: "Coupon & Promotion Terms",
    audience: "everyone",
    acceptance: null,
    sort: 8,
    body: `# Coupon & Promotion Terms

1. Coupons are issued by HelloCircle or by partners, and say who funds the discount.
2. Each coupon has its own limits: expiry, minimum spend, number of uses, and the listings it applies to.
3. Coupons have no cash value, can't be exchanged, and can be withdrawn if misused.
4. If a booking made with a coupon is refunded, the refund is of the amount actually paid.
5. A partner-funded coupon reduces the partner's fee base. A HelloCircle-funded coupon doesn't reduce the partner's payout.

${CONTACT}`,
  },
  {
    key: "credits-wallet-terms",
    title: "Credits & Wallet Terms",
    audience: "customers",
    acceptance: null,
    sort: 9,
    body: `# Credits & Wallet Terms

1. Credits are a promotional or goodwill balance that can be used towards eligible bookings. They are not e-money, can't be bought, and can't be withdrawn as cash.
2. Credits expire as stated when they are issued.
3. Credits funded by HelloCircle don't reduce a partner's payout.
4. Credits obtained through misuse can be removed.

${CONTACT}`,
  },
  {
    key: "rewards-terms",
    title: "Rewards Terms",
    audience: "customers",
    acceptance: null,
    sort: 10,
    body: `# Rewards Terms

1. Customers earn reward points on eligible completed paid bookings. Points are confirmed after the activity is completed and the review period has passed.
2. Points can be converted into credits at the rate shown in the app. They have no cash value.
3. Points expire as stated in the app, and are reversed if the related booking is refunded.
4. HelloCircle may change or end the rewards programme with notice. Points already earned are honoured for a reasonable period.

${CONTACT}`,
  },
  {
    key: "privacy-policy",
    title: "Privacy Policy",
    audience: "everyone",
    acceptance: null,
    sort: 11,
    body: `# Privacy Policy

## 1. Who we are

This service ("HelloCircle", "we", "us") is operated by [[LEGAL_ENTITY_NAME]], registered at [[REGISTERED_ADDRESS]], the controller of your personal data. For any question about this policy or your personal data, contact [[PRIVACY_EMAIL]].

## 2. What we collect

What we collect depends on how you use the site:

- **Browsing:** a random identifier stored in your browser (not a cookie) so "My Life" works without an account — see our [Cookie Policy](/cookies).
- **Bookings:** your name, email, phone number, event details and any notes you provide.
- **Club registrations:** a child's name and date of birth, a parent or guardian's name, email, phone and address, an emergency contact, and any medical information you choose to share so the club can look after your child safely.
- **Partner accounts:** business name, address, contact details and a description. Trader details required by law (see the [Trader Verification Policy](/policies/trader-verification) and [DAC7 Seller Notice](/policies/dac7-seller-notice)).
- **Payments:** we never see or store your card details. Payments are handled by Stripe — see [Stripe's privacy policy](https://stripe.com/ie/privacy).

## 3. Children's data

Club registrations involve a child's personal data. A parent or guardian provides it on the child's behalf. It is shared only with the specific club, never used for marketing, and never sold.

## 4. Why we process your data

- **To perform a contract with you:** to confirm a booking or registration, take payment, and let the partner contact you.
- **Legitimate interest:** to keep the platform secure, prevent fraud, and improve the service.
- **Legal obligation:** for example, retaining payment records for tax purposes, and reporting seller information under DAC7.

## 5. Who we share it with

The partner you book with, so they can fulfil your booking. Stripe, to take payments and make payouts. Our email provider, to send confirmations. Tax authorities, where the law requires it. We don't sell personal data or use it for advertising.

## 6. How long we keep it

Booking and registration records are kept for [[DATA_RETENTION_PERIOD]] to resolve disputes and meet accounting and tax obligations, then deleted.

## 7. Your rights

Under the GDPR, you have the right to:

- access the personal data we hold about you
- have inaccurate data corrected
- ask us to erase your data
- object to, or restrict, how we process your data
- receive your data in a portable format

Contact [[PRIVACY_EMAIL]] to use any of these rights. You can also complain to the Irish Data Protection Commission at [dataprotection.ie](https://www.dataprotection.ie).

## 8. Cookies & local storage

See our [Cookie Policy](/cookies).

## 9. Marketing

We send marketing emails only if you opt in, and you can opt out at any time in your notification settings. Accepting our Terms or reading this notice doesn't opt you in.

## 10. Changes

If this notice changes materially, we'll tell you before the change takes effect and ask you to read the new version.`,
  },
  {
    key: "cookie-policy",
    title: "Cookie Policy",
    audience: "everyone",
    acceptance: null,
    sort: 12,
    body: `# Cookie Policy

Most of what we store is strictly necessary to run the site. Analytics cookies and advertising cookies are two separate choices: each is used only if you turn it on in the cookie banner, and choosing one never turns on the other.

## What we store, and why

- **hello_circle_session** (cookie): keeps you signed in to a partner or admin account. It is httpOnly, so page scripts can't read it. Lasts 30 days, or until you sign out.
- **Resident session** (cookie): keeps you signed in after a magic link. Lasts until it expires or you sign out.
- **hello_circle_client_id** (local storage): a random ID, not linked to your identity, so "My Life" can show your bookings without an account. Kept until you clear site data.
- **hello_circle_favorites** (local storage): remembers your saved venues and clubs. Kept until you clear site data.
- **hello_circle_cookie_consent** (local storage): remembers your analytics choice. Kept until you clear site data.
- **_ga, _ga_\\*** (cookie): Google Analytics statistics. Only set if you accept analytics. Lasts up to 2 years.
- **Advertising cookies (e.g. _gcl_\\*)** (cookie): advertising measurement and personalisation. Only set if you accept advertising. Lasts up to 90 days.

## Third parties

At checkout, Stripe may set its own cookies, governed by [Stripe's privacy policy](https://stripe.com/ie/privacy). If you accept analytics, Google Analytics and Google Tag Manager load. Neither loads if you decline.

## Managing storage

Everything except analytics and advertising is strictly necessary. You can change either choice below, or clear site data in your browser settings. Clearing it signs you out and resets your choices.

Questions: [[PRIVACY_EMAIL]].`,
  },
  {
    key: "community-safety",
    title: "Community & Safety Standards",
    audience: "everyone",
    acceptance: null,
    sort: 13,
    body: `# Community & Safety Standards

## 1. Respect

1. Treat other members, hosts and partners with respect. No harassment, hate, threats or discrimination.

## 2. Safety at activities

1. Partners and hosts are responsible for running activities safely, including risk assessment, suitable supervision and first aid where appropriate.
2. Activities involving children must follow applicable safeguarding requirements.

## 3. Honest listings and reviews

1. Listings must describe the activity accurately. Reviews must reflect genuine experience. Fake or incentivised reviews are not allowed.

## 4. Reporting

1. Report content or behaviour using the report buttons or the [complaints form](/complaints). In an emergency, contact emergency services first.

## 5. Enforcement

1. We may remove content, restrict features or suspend accounts. We explain our decision and you can appeal — see [Complaints, Moderation & Appeals](/policies/complaints-appeals).`,
  },
  {
    key: "acceptable-use",
    title: "Acceptable Use Policy",
    audience: "everyone",
    acceptance: null,
    sort: 14,
    body: `# Acceptable Use Policy

You must not:

- break the law, or list illegal activities, products or services
- take payment for HelloCircle bookings outside the platform
- scrape, overload or attack the service, or try to bypass security
- impersonate others, or create accounts in order to manipulate reviews, rewards or coupons
- upload content you don't have the rights to, or content that is harmful, sexual or violent
- collect other users' personal data without a lawful basis

Breaches may lead to removal of content and suspension, as set out in [Complaints, Moderation & Appeals](/policies/complaints-appeals).`,
  },
  {
    key: "complaints-appeals",
    title: "Complaints, Moderation & Appeals",
    audience: "everyone",
    acceptance: null,
    sort: 15,
    body: `# Complaints, Moderation & Appeals

## 1. Reporting illegal content (notice and action)

1. Anyone can report content they believe is illegal, or that breaks our standards, using the report buttons or the [complaints form](/complaints). Include where the content is and why you are reporting it.
2. We acknowledge reports and process them diligently and objectively.

## 2. Our decisions

1. When we remove content, restrict visibility, suspend an account or withhold a payout, we give the affected person a statement of reasons: what we decided, the facts, the rule relied on, and how to appeal.

## 3. Appeals (internal complaint handling)

1. You can appeal a decision within [6 months — legal review required] using the [complaints form](/complaints), choosing "Appeal a decision".
2. Appeals are reviewed by someone other than the person who made the original decision. We tell you the outcome and our reasons.

## 4. Other options

1. You may also use a certified out-of-court dispute settlement body, or the courts. [List of bodies — legal review required.]

## 5. Complaints about a booking

1. Contact the partner first. If it is not resolved, use the [complaints form](/complaints), and we will respond within [response time — legal review required].

${CONTACT}`,
  },
  {
    key: "dac7-seller-notice",
    title: "DAC7 Seller Notice",
    audience: "partners",
    acceptance: null,
    sort: 16,
    body: `# DAC7 Seller Notice

1. Under EU Council Directive 2021/514 (DAC7), as implemented in [[GOVERNING_LAW]], online platforms must collect and verify information about sellers, and report it to the tax authority each year.
2. If you sell activities through HelloCircle, we collect: your name, address, tax identification number (TIN), VAT number where you have one, date of birth (individuals) or company registration number (entities), your payout account details, and the consideration paid to you, with the fees and number of activities per quarter.
3. We report this information to [the Irish Revenue Commissioners — legal review required], who may share it with other EU tax authorities. We give you a copy of the information reported about you.
4. If you don't provide the required information after reminders, we must withhold payouts or close your seller account.
5. [Exemptions and thresholds — legal review required.]

${CONTACT}`,
  },
  {
    key: "trader-verification",
    title: "Trader Verification Policy",
    audience: "partners",
    acceptance: null,
    sort: 17,
    body: `# Trader Verification Policy

1. Before you can sell paid activities, you give us your trader details: legal name, address, phone, email, company registration number (if any), and a self-certification that you only offer products and services that comply with EU law.
2. We make reasonable efforts to check this information, including through Stripe's identity verification for payouts.
3. Your trader name, address, contact details and registration number are shown to customers on your listings, as the Digital Services Act requires.
4. We may suspend selling until incomplete or incorrect details are fixed. We give you a statement of reasons and you can appeal.

${CONTACT}`,
  },
  {
    key: "accessibility-statement",
    title: "Accessibility Statement",
    audience: "everyone",
    acceptance: null,
    sort: 18,
    body: `# Accessibility Statement

1. HelloCircle aims to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA.
2. Known limitations: [list from accessibility audit — review required].
3. Partners provide each listing's accessibility information. Contact the partner for specific needs.
4. If something doesn't work for you, contact [[SUPPORT_EMAIL]]. We aim to respond within [response time].
5. This statement was last reviewed on [date].`,
  },
];
