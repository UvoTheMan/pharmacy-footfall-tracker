# Daily CSV backup and email delivery

This feature is additive and lives on `feature/daily-csv-email-backup`. It does not depend on the branch-correction PR.

## Files

- `supabase/functions/daily-footfall-backup/index.ts`: server-only CSV generation and Resend delivery.
- `supabase/migrations/202610110001_daily_footfall_backup.sql`: private run log used for retry protection and diagnostics.

## Safety notes

- Never put the Supabase service-role key, Resend API key, or backup trigger secret in Vite variables or frontend code.
- The Edge Function reads `visits` using the server-side service-role key. It does not change staff RLS policies.
- The migration creates one private run-log table only. It does not alter existing visit data, authentication, memberships, or policies.
- The recipient list defaults to `victorokolie911@gmail.com`. Add the second address to `BACKUP_RECIPIENTS` later as a comma-separated value.
- The function supports a `dryRun: true` request that reports filenames and record counts without sending an email.
- The function refuses to send if its run-log table is missing. Apply the migration before testing delivery.

## Required server-side Edge Function secrets

Configure these under Supabase Dashboard > Edge Functions > Secrets:

- `RESEND_API_KEY`: Resend API key.
- `BACKUP_FROM_EMAIL`: sender address verified with Resend.
- `BACKUP_RECIPIENTS`: `victorokolie911@gmail.com` for now. Later, use comma-separated addresses.
- `BACKUP_CRON_SECRET`: a newly generated random secret of at least 32 characters. Keep a copy only for the database Vault setup and authorized manual tests.

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Confirm the service-role secret is available in the Edge Function environment, and never expose it to the browser.

## Deployment and testing checklist

1. Review this pull request and confirm the target Supabase project is Production before applying the additive migration. Do not apply it to Production without approval.
2. Deploy `daily-footfall-backup` as a Supabase Edge Function. It validates the private `x-backup-secret` header itself, so the HTTP gateway JWT verification setting must allow the scheduled request to reach the function. Keep the function protected by its own secret check.
3. Set the server-side secrets above.
4. Test first with `dryRun: true`, using the intended Lagos date. Confirm the three branch counts add up to the combined count, and inspect filenames.
5. Send a real test only after the sender domain is verified in Resend. Check all four attachments and the recipient list.
6. Set up the scheduled invocation only after manual testing succeeds.
7. Confirm the run log records `sent` and that a repeated request for the same date is skipped.

## Daily schedule

Lagos is UTC+1 year-round. 11:59 PM Africa/Lagos is 22:59 UTC, so the cron expression is:

```text
59 22 * * *
```

Use Supabase Cron to invoke the Edge Function every day at that time. Store the project URL and `BACKUP_CRON_SECRET` in Supabase Vault, then have the scheduled SQL job read those Vault values when making the HTTP request. Do not hardcode the secret in a migration or commit it to Git. Confirm that the database's `pg_cron`, `pg_net`, and Vault extensions are enabled before scheduling. Use the project URL ending in `/functions/v1/daily-footfall-backup` and send a POST request with `x-backup-secret` and JSON body `{}`.

## Retry and duplicate handling

The backup date is unique in `footfall_backup_runs`. A run already marked `sent` is skipped. Resend receives an idempotency key based on the backup date, which helps prevent duplicate delivery if the provider accepted a request but the function did not receive its response. Failed attempts are logged and can be retried. Check the Supabase Edge Function logs, run-log row, and Resend email logs when diagnosing failures.

## Volume and delivery checks before production

Visit records are read in stable 1,000-row pages, so Supabase's usual per-response row cap will not silently truncate the report. The four CSVs are attached to a single email, so confirm real attachment sizes against Resend's current message-size limits during the manual test. If daily volume grows substantially, consider a compressed attachment or separate messages rather than silently dropping records.
