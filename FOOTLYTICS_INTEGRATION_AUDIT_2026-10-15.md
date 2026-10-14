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

## Changes applied on the integration branch
- Ported the enhanced `AdminAnalytics.tsx` and its dedicated `AdminAnalytics.css` only; no global stylesheet or unrelated feature files were copied.
- Added `jspdf ^3.0.1` to `package.json` for report export. This repository has no `package-lock.json` on `main`.
- Updated analytics outcome typing to support `undecided` visits.
- Updated current and previous conversion calculations to exclude `undecided` visits from the conversion denominator, matching the current `main` implementation.
- Added `Undecided` to the outcome distribution so visit outcomes are not silently omitted.
- Did not copy the unavailable-item migrations or unrelated global CSS.

## Verification still required
1. Confirm the latest Vercel Preview build completes successfully. An earlier intermediate commit failed because the component was committed before the PDF dependency; the later commit includes the dependency and is still building as of this audit update.
2. Check analytics sections, date ranges, previous-period comparisons, PDF export, reason breakdowns, and branch filters in Preview.
3. Verify the reason summary against real saved records.
4. Keep the known manual-backup blocker visible and resolve it separately; this audit does not resolve it.

## Current status
- Application changes are isolated to the integration branch and are not merged to `main`.
- No Production database, environment, or deployment has been changed.
