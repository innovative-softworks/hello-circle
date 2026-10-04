# HC-QA-100 — Activities and programme sessions created in Irish summer time were stored one day early

Severity: **P1** (silent wrong date on a published activity or session; a core host/vendor flow; about 7 months a year). Category: DATA / FUNCTIONAL.
Status: FIXED LOCALLY — NOT DEPLOYED (Phase 13, 2026-10-04). Found in Phase 13 while fixing HC-QA-077.

- **Screens:**
  - Host → create activity (`HostGamePage`), including single, non-repeating activities.
  - Vendor → programme → Add session(s) (`VendorPrograms`).
- **Actors:** host, vendor.
- **Environment:** any browser whose device timezone is east of UTC. That includes **every device in Ireland during Irish summer time (IST, UTC+1, late March → late October)**.
- **Steps:**
  1. In a `Europe/Dublin` browser, open a programme and add a session for Thursday 15 July 2027.
  2. Add a weekly ×3 series starting Thursday 5 August 2027.
- **Expected:** stored dates 2027-07-15 and 2027-08-05, 12, 19.
- **Actual (before):** stored 2027-07-14 and 2027-08-04, 11, 18, all Wednesdays. Winter dates (GMT) were unaffected.
- **Root cause:** both schedule builders turned the picked `YYYY-MM-DD` into **local midnight** (`new Date("…T00:00:00")`) and then read it back with `toISOString()` (UTC). East of UTC, local midnight is still the previous day in UTC. The loop runs for single creates too (`count = 1`).
  - Nothing caught it: QA browsers ran in the host machine's timezone, and no test asserted the stored date of a UI-created item.
- **Fix (systemic):** `client/src/irelandDate.ts`. `occurrenceDates(start, repeat, count)` does pure calendar arithmetic on the date string. It's used by both `HostGamePage` and `VendorPrograms`, and works in any device timezone.
  - A source guard test forbids `toISOString().slice(0, 10)` anywhere else in the client.
  - The occurrences field now has an accessible name ("Number of sessions").
- **Regression:**
  - `tests/integration/specs/product-p13-a.spec.ts` HC-QA-100: a real browser with `timezoneId: "Europe/Dublin"` checks the dates stored in the DB. It **fails before** (dates one day early) and **passes after**.
  - `client/src/irelandDate.test.ts` covers `occurrenceDates`, DST changeovers and weekday preservation.
  - All of it passes under the Europe/Dublin, UTC, Asia/Kolkata, America/Los_Angeles and Pacific/Kiritimati device timezones.
- **Existing data:** rows created through the UI on IST dates before this fix may already carry the wrong date. They can't be told apart from intentional dates automatically, so there's no automatic backfill. Ask hosts and vendors to review upcoming items created between late March and late October.
