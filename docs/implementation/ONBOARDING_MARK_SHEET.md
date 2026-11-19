# Onboarding: optional intern mark sheet (migration 012)

Interns using the AI Onboarding Assistant can now attach their latest mark sheet. Every part of the request still works without it: the applicant can choose **Skip for now** at any point.

## What the applicant sees
- After the "Your internship" card, interns get one more card: **Academic record (optional)**.
  - They can drag a file in or browse for one (PDF, JPG or PNG, up to 5 MB).
  - Before leaving the card they choose **Attach and continue** or **Skip for now**.
- The file is kept in page memory only. It is uploaded after the email code is verified, just before the request is submitted.
  - If the upload fails, the applicant can try again, choose another file, or submit without it.
- The review card shows an "Academic record" section with an Edit button.

## Server rules (Core API)
- **New step:** `POST /api/onboarding/document` (relayed by `onboarding/relay.mjs` as `document`).
  - Works only for a verified draft (`EMAIL_VERIFIED`).
  - Works only for roles that list the kind. Today that is `INTERN` → `MARK_SHEET`.
  - The body is `{ kind, file_name, data_base64 }`, or `{ kind, action: 'remove' }` to remove the file.
- **File checks:**
  - The type is proven by the file's first bytes. A renamed file is refused.
  - The file name is cleaned.
  - The size is capped at 5 MB.
- **Storage and access:**
  - Stored AES-256-GCM encrypted under `TOKEN_ENCRYPTION_KEY`, with a SHA-256 checksum.
  - Without a valid key, uploads are switched off: the card is not shown and the step answers 503. A file is never stored in the clear.
  - Reviewers see the file's metadata in the request detail and download it from `GET /api/core/registrations/:id/documents/:kind` (`registration.review` permission).
  - The download is sent as an attachment with `nosniff` and a sandbox CSP.
  - Every download is audited (`registration.document_viewed`), and so are attach and remove.
- **When the file is deleted:**
  - when the applicant removes or replaces it
  - when the role changes to one without documents
  - when a draft expires or is superseded (sweep)
  - with the request itself (`ON DELETE CASCADE`, retention purge)
- **Key rotation:** `npm run rewrap-secrets` re-encrypts the stored files too.

## Compatibility
- **Additive:** one new table, `registration_documents`. No existing table or row changes.
- **Databases:** SQLite and Postgres (no semicolons inside a statement).
- **Older code:** it ignores the table. Older assistant pages don't send the step.
- **Admin UIs:** the gateway admin console and the Learning Hub's Registrations tab both show the documents.

## Rollback
- **012 only:** `rollbackRegistrationDocuments(db)` (`src/core/rollback.js`).
  - Drops `registration_documents` and its migration record. Access requests are untouched.
  - Starting the server again recreates the empty table.
- **Full R1 rollback:** `npm run core:rollback-identity -- --yes` now also drops the table and the 012 record.
- Both are covered by tests.

## Tests
- `apps/api/test/onboardingDocuments.test.js` and `onboardingDocumentsNoKey.test.js`
- `coreMigration.test.js`, updated for 012
- `tools/e2e/onboarding-app-ui.mjs`: browser flow, attach, review, reviewer download button

## Open decision for the founder
Mark sheets often show a **date of birth** and a **photo**. The onboarding rules say birth dates are never collected (DEC-015). Mitigations in place:
- The upload is optional.
- The card asks applicants to cover their date of birth and photo before uploading.
- Only reviewers can see the file.
- It is deleted with the request.

Still to decide:
- Should the consent notice (DEC-016) name the mark sheet?
- Should a retention period (`ONBOARDING_RETENTION_DAYS`) be required before this is enabled in production?
