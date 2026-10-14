# Footlytics Integration Audit — 15 October 2026

## Scope and safety
- Integration branch: `release/footlytics-integration-2026-10-15`
- Base: `main` at `75041f4d0ee9e4155f542e3e0a32359c81e0705b`
- This branch is preparation/review only.
- Do not merge to `main`, alter Production Supabase, or deploy Production without explicit approval.

## Analytics integration findings
- PR #28 changes only `src/components/AdminAnalytics.tsx`, `src/components/AdminAnalytics.css`, and its checkpoint note relative to `feature/admin-analysis-dashboard`.
- The current `main` already has an `AdminAnalytics` component wired into `App.tsx`, but it is a simpler implementation and does not have the dedicated `src/components/AdminAnalytics.css` file.
- The enhanced analytics component imports `jspdf`; `main/package.json` does not currently include it. The feature branch adds `jspdf ^3.0.1`.
- The enhanced component currently types outcomes as only `purchased | not_purchased` and calculates conversion using all rows as the denominator. The current `main` application supports an `undecided` outcome. Porting the component unchanged could count undecided visits incorrectly in conversion metrics and weekday outcomes.
- The feature branch also contains wider UI/CSS work in `src/styles.css`; do not copy that whole file into the integration branch because it includes unrelated application changes.
- The unavailable-items migrations are not part of the analytics PR diff and must not be pulled in merely to get the analytics dashboard.

## Required before implementation
1. Adapt the enhanced analytics calculations to handle `undecided` visits consistently with the current app and agree on the conversion denominator.
2. Port only the analytics component and its dedicated CSS, adding the required PDF dependency in isolation.
3. Check CSS selectors against `main` and avoid copying unrelated global styles.
4. Run the project's build/checks on the integration branch and inspect the resulting Preview before considering any release.
5. Keep the known manual-backup blocker visible and resolve it separately; do not imply that this audit resolves it.

## Current status
- No application code has been changed on this integration branch.
- No Production resources have been changed.
