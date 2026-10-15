# Footlytics Checkpoint — 14 October 2026
## Snapshot
- Checkpoint branch: `checkpoint/analytics-pr28-2026-10-14`
- Snapshot source: PR #28 head commit `2b38b42aee7460dd14ca530886423f536508dd37`
- Related PR: [#28 Fix Admin Analytics visibility, comparisons, and breakdowns](https://github.com/UvoTheMan/pharmacy-footfall-tracker/pull/28)
- PR status at checkpoint: Open, unmerged; GitHub reports mergeable into its current base; latest Vercel status check reports success.
- Production was not changed. No merge was performed.

## Progress in PR #28
- Four core KPIs remain visible across analytics sections, with current/previous-period values and changes.
- Added current-vs-previous period comparisons, daily visits comparison, weekday purchase outcomes, and branch performance comparison.
- Added expanded branch summary details and per-branch reason breakdowns.
- Added PDF export with comparison insights and moved the export action to the bottom of the analytics page.
- Trends visualizations can be selected individually in Customise view.
- Operating-hours context is now a small note at the bottom of Analytics. Hourly analysis excludes pre-opening records in Lagos time (Mon–Sat 8:00 AM; Sunday 2:00 PM); daily totals remain unchanged.
- Reason-summary KPI now shows the leading reason and count, with distinct empty states for no no-purchase visits versus missing reason values.

## Verification status and remaining checks
- GitHub Vercel status check: success for the latest PR head SHA. This is a deployment/check status, not proof that all analytics behaviour has been manually tested.
- The reason metrics data path still needs to be checked against actual selected-period records if the empty/no-data display persists.
- Manual Preview testing of the analytics screens and PDF export is still required before any production decision.
- Existing separate concerns remain: blank white screen when re-entering Chrome and performance slowdowns need separate diagnosis/optimization.
- Manual-backup fix remains deferred as a known blocker from the earlier checkpoint.
- Do not test or alter Production while reviewing these changes.

## Main / Production merge assessment
- PR #28 currently targets `feature/admin-analysis-dashboard`, not `main`.
- Comparison of PR head against its current base: 13 commits ahead, 0 behind; changes in that comparison are limited to `src/components/AdminAnalytics.tsx` and `src/components/AdminAnalytics.css`.
- The feature base itself is 47 commits ahead of `main`. PR head compared directly with `main` is 60 commits ahead, 0 behind, with changes beyond analytics including app/auth/backup/corrections work, unavailable-item UI, and three Supabase migrations.
- Therefore, do **not** retarget or merge PR #28 directly into `main` as-is: that would potentially bring the entire 60-commit feature stack into Production, not just the analytics changes.
- Safer path: finish Preview/manual verification, inspect and resolve the reason-data issue, then prepare a separate minimal integration PR against `main` containing only the intended analytics changes after checking dependencies. Review any required database migrations independently.
- No merge was performed and no Production deployment/configuration was changed.
