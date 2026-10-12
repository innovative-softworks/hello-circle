# 06 — Legal and compliance decision register

Nothing here is legal advice. Every policy produced will carry **"Draft — legal review required"** until a named
approver signs off in the policy workflow. Building pages doesn't make HelloCircle compliant.

| Topic | Known from the repository | Unknown / decision | Recommended default (to confirm) |
|---|---|---|---|
| Legal entity | Brand "HelloCircle"; GitHub org `innovative-softworks`; user email domain `isoftworks.eu` | Exact legal name, company number | `[[LEGAL_ENTITY_NAME]]` stays a placeholder and **blocks publication** |
| Country of incorporation | Domain `hellocircle.ie`, Irish product | Not stated | Ireland, to confirm |
| Stripe account country | — | Unknown | Must be IE/EEA, otherwise stop (05 #1) |
| VAT registration | — | Registered? Number? | Platform-fee VAT engine built configurable. **No VAT shown on fee invoices until registered** |
| Registered office | Privacy page shows `[Registered Address, Ireland]` | Unknown | Placeholder blocks publication |
| Support / legal / privacy contact | Privacy page shows `[privacy@yourdomain.ie]` | Unknown | Placeholders |
| Data controller / DPO contact | Privacy page names the Irish DPC as the complaints route | Controller identity | The legal entity is the controller |
| Merchant of record | Platform account charges today | Seller-of-record wording for the underlying activity | HelloCircle is merchant of record for **payment**. The partner is the **supplier of the activity**, named on the listing, checkout and receipt (DSA trader identification) |
| Partner tax responsibility | — | — | Partners are responsible for VAT on their activity. HelloCircle invoices its fee plus VAT |
| DAC7 | No seller data collection | Applicability, thresholds | Collect trader data (`trader_profiles`) from day one. Annual report generation is designed, built in a later stage |
| Consumer cancellation/refund | Per-org cancellation hours. Refunds manual and full-only | Statutory exceptions for leisure services on a specific date | Configurable cancellation policy per listing/activity type. Texts reviewed by a solicitor |
| DSA marketplace duties | Reports and moderation exist; no trader verification, appeals or statements of reasons | — | Trader verification before selling paid listings. Reasons for moderation decisions. Appeals |
| Vendor verification | Admin approves vendors; hosts are verified manually | Evidence required | Stripe KYC for payouts plus `trader_profiles` for DSA/DAC7 |
| Children / minors | Club registrations collect child data, guardian consent, medical info | Minimum user age, safeguarding obligations | `[[MINIMUM_USER_AGE]]` placeholder. Child data never used for marketing (already stated) |
| Insurance | None recorded | Required for which activity types? | `insurance_expires_at` on trader profiles. Configurable blocking per activity category |
| Health & safety | Experience safety fields exist | Responsibility split | Partner responsible for delivery safety (Host/Vendor Agreement) |
| Cookies | `CookieNotice` banner and GTM consent module; non-essential cookies off until consent | Cookie inventory completeness | Keep. The Cookie Policy moves into the CMS |
| Accessibility | No statement | WCAG target | WCAG 2.2 AA target statement (draft) |
| Data retention | No purge or anonymise jobs | Retention periods per data class | `[[DATA_RETENTION_PERIOD]]`. Financial records kept for 6 years (Irish tax practice, to confirm) |

## Mandatory placeholders (publication is refused while any remain)

`[[LEGAL_ENTITY_NAME]]` `[[TRADING_NAME]]` `[[COMPANY_NUMBER]]` `[[VAT_NUMBER]]` `[[REGISTERED_ADDRESS]]`
`[[SUPPORT_EMAIL]]` `[[LEGAL_EMAIL]]` `[[PRIVACY_EMAIL]]` `[[PHONE_NUMBER]]` `[[STRIPE_ACCOUNT_COUNTRY]]`
`[[GOVERNING_LAW]]` `[[COURT_JURISDICTION]]` `[[DATA_RETENTION_PERIOD]]` `[[MINIMUM_USER_AGE]]`

## The 18 required documents

Each is a CMS document seeded as a **structured draft** (headings and clauses with placeholders, not final legal
text), status `draft`, flag "legal review required":
1. General Terms
2. Customer Booking Terms
3. Vendor & Venue Agreement
4. Host Agreement
5. Payments, Fees & Payout Policy
6. Cancellation/Refund/No-show Policy
7. Pro Subscription Terms
8. Coupon & Promotion Terms
9. Credits & Wallet Terms
10. Rewards Terms
11. Privacy Policy (migrated)
12. Cookie Policy (migrated)
13. Community & Safety Standards
14. Acceptable Use
15. Complaints, Moderation & Appeals
16. DAC7 Seller Notice
17. Trader Verification Policy
18. Accessibility Statement

The current `/privacy` and `/cookies` URLs keep working: they render the published CMS version, or fall back to
the existing page until one is published.
