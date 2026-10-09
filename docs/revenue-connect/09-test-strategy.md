# 09 — Test strategy

All automated tests run in the existing **isolated Docker MySQL profile** (`npm run test --workspace server`). It
refuses `hello_circle` and `hello_circle_dev` and scrubs provider credentials. Stripe Sandbox tests run only in the
guarded `qa:stripe` harness with a **test-mode** key from env.

| Layer | What | Where |
|---|---|---|
| Unit | Each fee formula; minimum fees; VAT standard/exempt/reverse/inclusive; percentage and fixed splits; remainder rule; all coupon funding types; credits (expiry, partial use, currency); points (earn after settlement, reverse, expire, redeem); Pro break-even (€29 / 2% = €1,450); partial and full refunds; dispute recovery; negative-margin warnings. **Brief test vectors T1–T7 as golden tests**, plus property tests that every allocation reconciles exactly | `server/src/commerce/*.test.ts` |
| Integration (stub) | Checkout → order → snapshot → ledger. Duplicate, out-of-order and replayed webhooks. Partial refund → allocation and transfer reversal. Dispute → reversal and partner recovery. Failed payout. Settlement thresholds and carry-forward. Subscription renewal, failure, grace, downgrade. Reward redemption. Policy acceptance and re-acceptance gating. Placeholder publication block | `server/src/**/*.test.ts` with `StubProvider` |
| Integration (Sandbox) | Connect onboarding link, charge, `transfer_group`/`source_transaction` transfers, payouts, refunds with `reverse_transfer`, dispute test cards, Billing invoices, webhook signatures (Stripe CLI forwarding) | `tests/integration/stripe-*.ts` (`qa:stripe`) |
| E2E by role | Customer, vendor, host, venue staff, admin, finance, support, legal | Playwright (`qa:e2e`) |
| Security | Finance authorisation per admin role; IDOR on orders, statements and credits; forged and replayed webhooks; coupon abuse; credit double-spend (concurrent redemption); reward manipulation; privilege escalation (`admin_role`); no secrets or PII in logs | `qa:security-gate` plus unit tests |
| Accessibility | Keyboard, screen-reader labels, focus, errors, contrast, responsive tables, policy pages, live calculators (aria-live) | `tests/integration/a11y-audit.ts` |
| Rollback | Flag on/off cycle with hashes (see 08) | server tests |
| Regression | The existing 597 server and 105 client tests stay green. **No test is weakened, skipped or deleted** | every phase |

Evidence for each phase goes into `docs/revenue-connect/rollout.md`: the exact command, counts, and the shadow-diff
summary.
