# 18 · Governance: medical notes, retention and privacy wording

**Date:** 2026-10-29.
**Branch:** `feature/participation-phase2`. Local only: not pushed, not deployed.
**Status:** decisions for the owner and legal reviewer. No data has been read, changed or deleted in any shared environment.

## 1. Privacy-policy wording that needs legal review
Since D-A4 (doc 15), the platform **no longer collects** free-text medical information. Two published texts still say it does:

| Where | Current wording (excerpt) | Why it needs review |
|---|---|---|
| `client/src/pages/PrivacyPolicy.tsx`, §2 "What we collect", club registrations bullet | "…an emergency contact, and any medical information you choose to share so the club can look after your child safely." | New registrations no longer ask for it. Existing registrations still hold legacy notes, so the policy has to cover data that **is held** but **no longer collected**. |
| `client/src/pages/PrivacyPolicy.tsx`, §3 "Children's data" | "…(name, date of birth, and any medical information relevant to their participation)…" | Same as above. This is also children's special-category (health) data, so it needs a lawful basis under Art. 9 GDPR and a retention statement. |
| `server/src/policy/drafts.ts`, privacy draft §2, club registrations bullet | the same sentence as the first row | This is the managed policy draft (Policies admin). It should change in step with the page. |

**Questions for the reviewer. No wording has been changed, by design:**
1. **Legacy notes.** Should the policy say medical notes were collected **until** a date, and are now held only for existing registrations?
2. **Retention.** What retention period applies to those legacy notes, and to registration answers generally (see §3)?
3. **Lawful basis.** What is the Art. 9 basis for the notes already held, and who at the club may see them? Today nobody can: no screen or API reads them.
4. **Future collection.** Should the policy name the **"Sensitive registration questions"** switch? It's locked, and would need this review before it's unlocked.
5. **Policy versions.** Does the change call for a new policy version, and should the published text be re-acknowledged?

## 2. Counting legacy medical notes (authorised operator, read only)
**What it does:**
- **Script:** `server/src/scripts/privacyCounts.ts`, with the logic in `server/src/privacyCounts.ts`.
- **Output:** numbers only. It never selects, returns or prints a note, an answer, a name, an email or a booking reference. Every query is `COUNT`, `SUM(medical <> '')` or `MIN`/`MAX` of a date, and dates are reported only to the month.
- **Read only:**
  - It uses its own connection.
  - It sets the session to `READ ONLY` and runs inside `START TRANSACTION READ ONLY`, so MySQL refuses any write. It ends with `ROLLBACK`.
  - The app's schema set-up (`initSchema`) never runs.
- **Database guard:**
  - It runs against `hello_circle_dev` by default.
  - Any other database must be named explicitly with `--allow-db=<name>`, the same guard as `category-report`.
- **Test:** `server/src/privacyCounts.test.ts`, in the disposable test database. It inserts a note with a unique marker, then proves:
  - the count includes it;
  - the marker, the email and the references never appear in the output;
  - the note is unchanged afterwards.

**Procedure:**
1. **Authorisation.** Get written approval from the data owner to run counts in the target environment, for example production. Record the date and the reason.
2. **Credentials.** Use a **read-only** database account for that environment (`SELECT` only, on that schema), not the app's account. A DBA can create one with: `CREATE USER 'hc_privacy_ro'@'localhost' IDENTIFIED BY '<set by the DBA>'; GRANT SELECT ON <db>.* TO 'hc_privacy_ro'@'localhost';`. This means the database guards against writes twice: through the grant and through the read-only transaction.
3. **Running it.** Run it on the server that already hosts that environment. Don't copy data out. Pass the credentials as environment variables for this one command; don't write them to `.env`:
   ```bash
   cd server
   DB_USER=hc_privacy_ro DB_PASSWORD='…' DB_NAME=<db> \
     npm run privacy-counts --workspace server -- --allow-db=<db>
   ```
   *(Or run `npx tsx src/scripts/privacyCounts.ts --allow-db=<db>` from `server/`.)*
4. **Output.** The output is JSON:
   ```json
   { "database": "<db>",
     "medical": { "columnPresent": true, "registrations": 0, "withNote": 0,
                  "byYear": [{ "year": 2026, "withNote": 0 }],
                  "firstMonth": "2026-03", "lastMonth": "2026-10" },
     "answersPastRetention": "no retention period set" }
   ```
5. **Recording.** Record only the numbers in the review ticket. Don't add screenshots of database tools or any query that selects `registrations.medical`.
6. **Clean-up.** Afterwards, the DBA drops the read-only account, or keeps it locked.

**What it doesn't do:**
- It doesn't run on a schedule or as part of start-up.
- It doesn't export rows.
- It never deletes anything.

## 3. No automatic deletion
- **Legacy medical notes.** They stay in `registrations.medical`, untouched.
  - New registrations always store `""`.
  - No route or screen reads the column. `privacyMedical.test.ts` checks the source code for this.
  - Deleting or archiving notes is an owner and legal decision after §1. No job, sweep or script deletes them.
- **Expired registration answers.**
  - Admin's field policy can set a retention period per data class. Today none is set: every class is "until the retention review".
  - When one is set, admin sees **how many** answers are past it (`answersPastRetention`), and so does this script. They are counts only.
  - Nothing removes answers automatically. A future erasure step would be a separate, reviewed change with its own audit trail.

## 4. Sensitive-field collection stays off
- **The switch.** `participation.special_category_questions` is defined with `locked: true` in `server/src/circleFeatures.ts`. Admin Settings shows it, but any attempt to switch it on is refused with 409 (`LockedFeatureError`).
- **While it's off**, the question engine (`participation/questions.ts`) refuses:
  - questions in a special category;
  - **own questions** whose wording looks like health, religion, ethnicity and similar topics.
- **Ready-made fields.** They're vetted platform wording. "Food preference" is a dietary preference, not a health question.
- **Unchanged.** Nothing in this governance work changes the switch.
