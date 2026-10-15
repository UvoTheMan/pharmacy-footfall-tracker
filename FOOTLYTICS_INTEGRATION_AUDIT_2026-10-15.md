# Footlytics Release Integration Audit — 15 October 2026

## Release safety and source of truth

- Production baseline: `main` at `75041f4d0ee9e4155f542e3e0a32359c81e0705b`.
- Integration branch: `release/footlytics-integration-2026-10-15`.
- Source checkpoint audited: `checkpoint/analytics-pr28-2026-10-14` (61 commits ahead of `main`, 0 behind at the time of comparison).
- Integration branch is a selective, compatibility-reviewed port, not a blind merge of the checkpoint's commit stack. Current GitHub comparison before this audit refresh: 43 commits ahead of `main`, 0 behind. This audit refresh is the next documentation-only commit. The source checkpoint is 61 commits ahead of `main`, 0 behind. The branches intentionally do not share checkpoint ancestry, so release readiness is determined by feature/file-level parity and compatibility review, not commit count alone. All 13 paths changed by the checkpoint are represented in the integration branch; the original checkpoint document is also preserved here, alongside the versioned manual-backup Edge Function, CI build guard, and this audit.
- Never merge to `main`, deploy Production, or apply Production database migrations without explicit user authorization.
- No Production database, environment variable, Edge Function, or deployment was changed during this work.

## Feature-by-feature checkpoint coverage

| Checkpoint area | Integration status | Compatibility notes |
|---|---|---|
| Enhanced Admin Analytics | Integrated | Four tabs and four core KPIs, 7/30/90-day presets/custom date filters, current-versus-previous comparisons, daily and weekday outcome trends, branch comparisons and expanded branch summaries, per-branch reason breakdowns, chart visibility controls, operating-hours context, leading-reason KPI with count, distinct empty states, and PDF export are retained. The previously noted selected-period reason-data path still requires Preview verification if the empty/no-data display persists. |
| Analytics PDF performance | Integrated | `jspdf` is lazy-loaded only when PDF export is requested. Prior verified build reduced the initial JS chunk from 876.65 KB to 485.12 KB (about 44.7%); jsPDF is split into a separate ~388.48 KB chunk. |
| Undecided/legacy visit handling | Compatibility-preserved | Existing `undecided` records remain typed and visible in outcome distribution. Conversion calculations exclude undecided visits from the denominator. Historical visits use the checkpoint's “Legacy record” display treatment, while the analytics data still counts these visits correctly. |
| Unavailable-item entry | Integrated | Staff can report a requested item when the visit ends in no purchase due to unavailability or when another item is purchased instead. Product name, strength/form, optional photo, and size/type checks are wired. |
| Deferred unavailable-item details | Integrated | A visit can be saved with an outstanding-details marker; Recent Visits now exposes “Add details” and supports later product detail/photo capture. |
| Shared unavailable-items register | Integrated | Search, branch/date filters, photo viewing, item-name correction, CSV export, individual status changes, and bulk reviewed/resolved actions are included. |
| Unavailable-item database | Migration files included; Production prerequisite | Four migrations cover register schema/RLS/RPC, private photo storage, photo-reference protection, and a safe active-branch-label RPC for the shared register. None has been applied to Production or staging by this integration work. |
| Chrome re-entry / blank-screen safeguard | Integrated in code; manual test pending | Auth initialization now prevents a late `getSession()` result from overwriting a newer auth event, and same-user re-entry/sign-in events do not unnecessarily clear the workspace. This is a targeted safeguard, not proof the reported blank-screen issue is fully resolved until tested in Chrome on mobile. |
| Branch-switch warning and confirmation | Integrated | Branch changes require confirmation and warn about interrupted entry. If visits already exist, the existing correction-request flow remains in force and pauses entry pending admin review. |
| Account menu | Integrated | Password change and sign-out are grouped in the account menu. |
| Manual backup branch scope | UI and source integrated; Production blocked | Staff requests include the active branch slug; the Edge Function validates active account and branch membership. Admin requests can request all three branch CSVs plus the combined report. |
| Manual backup environment safety | Source integrated; deployment/configuration pending | The versioned Edge Function requires explicit workflow ref, target environment, expected Supabase project ref, and workflow token; it refuses a project/environment mismatch. The remote Production function is currently absent. |
| Historical visits and CSV | Integrated | Previous 90 days remain available for history, today is permitted for exports, future dates are excluded, and staff/admin branch scoping is retained. |
| Existing Production functionality | Preserved in source | Login aliases, admin password authorization, branch correction workflow, daily footfall entry, no-purchase reasons, shared data refresh, history, analytics entry point, and scheduled backup code were not intentionally removed. |

## Changes in this integration branch

- Ported the enhanced `AdminAnalytics.tsx` and dedicated `AdminAnalytics.css`, adapting the component to the Production baseline's three outcomes: `purchased`, `not_purchased`, and `undecided`.
- Kept conversion denominators restricted to resolved visits (purchased or no purchase); footfall totals and outcome distribution continue to include undecided records.
- Added `jspdf ^3.0.1` and lazy-loaded it on export.
- Restored unavailable-item entry, the shared register, deferred details from Recent Visits, photo migrations, and the photo-reference guard.
- Fixed a branch-RLS compatibility gap in the shared unavailable-item register: staff could read shared reports but branch names for other branches were hidden by the branch table's stricter RLS policy. Added `list_active_branch_labels()` in `202610150001_unavailable_item_branch_labels.sql`, exposing only active branch labels to active users without widening the branch-selection policy. The UI falls back safely until that migration is applied.
- Ported the checkpoint's auth lifecycle safeguard, branch-switch confirmation, account menu, staff/admin manual-backup scope, and checkpoint testing-cutoff notice.
- Updated the Recent Visits correction component to support deferred product details; this was missing from an earlier integration attempt and is now included.
- Added the checkpoint's Historical Visits display update while retaining undecided outcome support elsewhere.
- Versioned `supabase/functions/manual-footfall-backup/index.ts` with configurable environment dispatch and a project-ref mismatch guard. This source change is not a remote deployment.
- Hardened deferred-item photo handling: verify the signed-in user once, remove an uploaded photo if the database insert fails, and surface cleanup failures rather than silently leaving an orphaned image.
- Paginated unavailable-item register reads in 1,000-row pages and batches signed-photo URL creation in groups of 100, avoiding silent truncation and oversized storage requests as the register grows.
- Delayed unavailable-item CSV object-URL cleanup so mobile browsers have time to begin the download.
- Confirmed update actions actually return the expected row(s) before displaying successful item-name, individual status, or bulk status updates.
- Disabled staff manual-backup submission until an active branch is selected.
- Added `.github/workflows/footlytics-integration-build.yml` as an independent TypeScript/Vite build guard for this release branch and pull requests to `main`. Its PR path filters have been widened to include Supabase migrations/functions and backup scripts, so backend-related edits also trigger the build guard. The latest Vercel build for the exact release-branch head is now READY; a successful GitHub Actions run remains separately unverified.

## Database and backup environment findings

- Staging project `zjskpzyzupacsosboiwc` has `public.unavailable_items`, photo storage policies, and the recording RPC. The staging register contained 11 rows at inspection. Staging migration history includes the register, photo, and protection migrations.
- Production project `yvcjwuprnjptdckartor` currently has no `public.unavailable_items` table, no `list_active_branch_labels()` function, and no `manual-footfall-backup` Edge Function. Required prerequisite functions `can_access_branch`, `is_active_admin`, and the branch-correction RPCs are present. Production migration history is incomplete relative to the live schema (it lists only branch-correction migrations despite the initial schema and unavailable-item flag already existing), so do not replay the full migration history blindly; review and apply only the approved new migrations after confirming the live schema.
- No migrations were applied to either project by this integration work.
- The versioned manual-backup Edge Function now requires these function settings before it can dispatch a workflow: `GITHUB_BACKUP_WORKFLOW_TOKEN`, `GITHUB_BACKUP_WORKFLOW_REF`, `GITHUB_BACKUP_TARGET_ENVIRONMENT`, and `BACKUP_EXPECTED_SUPABASE_PROJECT_REF`, alongside the standard Supabase function settings.
- Intended Production values, to be configured only as part of an approved release: workflow ref `main`, target environment `Production`, expected project ref `yvcjwuprnjptdckartor`. The GitHub Production environment must also have the required database/email secrets. These settings and the function deployment are not yet verified.
- The staging function currently active in Supabase is separate from the versioned source and has not been redeployed by this work.
- Do not change the existing daily scheduled CSV email workflow/schedule as part of this integration; its successful delivery was previously confirmed.

## Build verification

- Latest verified application-code deployment before the pagination improvement: commit `abad16f9755ace083b24ef5123c87737094b48c0` (`fix: show correct branch labels in shared unavailable register`). Vercel deployment `dpl_4Kjs8aFJF4WrTD1XnYzRAc6LbKcW` is `READY`, Preview URL: https://pharmacy-footfall-tracker-376knvarq-uvothemans-projects.vercel.app. The preceding commit containing the branch-label migration also built successfully as deployment `dpl_9zGdHeX3y4DqpQjA4wPGiyGrXNdx`. A subsequent commit `8a5c8b786440901ef4d0eb1bb8b1623e11ecccbd` adds register pagination and photo URL batching; it has been committed to the isolated release branch, but its fresh deployment could not be initiated through the connected Vercel tool because that operation returned a team-scope 403. Therefore the pagination improvement is not yet build-verified.
- These successful deployments supersede the earlier build-rate-limit failures for previous intermediate commits. Those earlier failures were hosting build-quota failures, not reported TypeScript errors.
- The independent GitHub Actions build workflow has been added to avoid relying solely on Vercel's build quota, but a successful run has not yet been verified.
- An earlier intermediate deployment failed when App.tsx was committed before the ManualBackup prop update landed; the subsequent complete branch state built successfully.
- Build success is not equivalent to authenticated, end-to-end feature verification.

## Required Preview verification before Production release

1. Sign in through the protected Vercel Preview on mobile Chrome; background/re-enter the browser and confirm the workspace never becomes a blank white screen or loses its branch unexpectedly.
2. Test branch selection, warning/confirmation, cancellation, branch persistence, and correction-request pause/review behaviour.
3. Test all four analytics tabs, 7/30/90-day presets, custom ranges, branch filtering, previous-period comparisons, chart visibility controls, reason counts, hourly opening-time rules, and PDF export.
4. Confirm undecided records contribute to total footfall and outcome distribution but not conversion denominators; verify reason-summary metrics against actual selected-period records and confirm empty states are accurate.
5. Test unavailable-item reporting for both outcomes; test defer-and-return from Recent Visits; validate photo type/size, upload/view permissions, item-name correction, search and filters, CSV export, individual admin status updates, and bulk review/resolution.
6. Test historical visit browsing, branch visibility, 90-day boundaries, and CSV export date limits.
7. Test manual backup with a staff account (only its assigned branch CSV) and admin account (three branch CSVs plus combined report). Confirm the resulting GitHub Actions job uses the intended Supabase environment and completes email delivery.
8. Confirm the existing scheduled CSV email continues to arrive. Do not modify its schedule.

## Release blockers and release decision

- **Not ready to merge/deploy yet.** Authenticated Preview tests above remain outstanding. The last verified deployment predates the latest pagination improvement, so a fresh Preview build and test are required before release.
- Production unavailable-item migrations, including the new branch-label RPC migration, require review and explicit approval before application. Preview testing of all-branch labels also depends on applying the new branch-label migration to the staging project first.
- Production manual-backup Edge Function is absent and must be deliberately deployed/configured/tested; the workflow ref, environment, expected project ref, token permissions, and GitHub Environment secrets must be verified.
- The reported Chrome re-entry blank screen and general slowdowns require manual reproduction after the auth safeguard and bundle-splitting changes.
- No Production merge, deployment, or database mutation is authorized by this audit.
