# Footlytics Integration Audit — 15 October 2026

## Scope and safety
- Integration branch: `release/footlytics-integration-2026-10-15`
- Base: `main` at `75041f4d0ee9e4155f542e3e0a32359c81e0705b`
- This branch is preparation/review only.
- Do not merge to `main`, alter Production Supabase, or deploy Production without explicit approval.

## Analytics integration findings
- The current `main` already has an `AdminAnalytics` component wired into `App.tsx`, but it is a simpler implementation and does not have the dedicated analytics stylesheet.
- The enhanced component requires `jspdf` for PDF export; `main/package.json` did not include it.
- The current application supports `purchased`, `not_purchased`, and `undecided`. Conversion metrics must exclude undecided visits from the denominator, while outcome distribution and footfall totals must still include them.
- Do not copy the development branch's entire global stylesheet or unrelated feature work into this release.
- Unavailable-item migrations are not required for the analytics component and have not been included.

## Changes on the integration branch
- Ported only `src/components/AdminAnalytics.tsx` and the dedicated `src/components/AdminAnalytics.css`.
- Added `jspdf ^3.0.1` to `package.json`. There is no `package-lock.json` on `main`.
- Adapted outcome typing and conversion denominators for undecided visits.
- Ensured undecided visits appear in outcome distribution and daily stacked charts.
- Lazy-loaded the PDF export dependency so PDF-generation code is requested when needed rather than on initial app load, addressing the large-bundle warning found during build review.
- Clarified conversion labels to say that conversion is based on resolved visits (purchased or no purchase).
- Corrected branch no-purchase-rate denominator to exclude undecided visits.
- Kept unrelated global CSS, unavailable-item migrations, and other development-branch features out of this integration.

## Build verification
- Vercel Preview build is **READY** for code commit `8805d63f6b5a81ff098946e511eb4d1bfbb8c436` (PDF export lazy-loaded).
- Preview URL: https://pharmacy-footfall-tracker-pec4o1td0-uvothemans-projects.vercel.app
- An intermediate build failed due to a missing closing JSX brace in the undecided chart segment. It was fixed in commit `9a834f78dfae938692d609da70a5fad7bd86c390`; the later build with lazy loading also passed.
- The Vercel web page could not be inspected through the available browser/search view. Interactive Preview testing remains required.

## Remaining release checks
1. In Preview, test all four analytics tabs, 7/30/90-day presets, custom date ranges, branch filtering, previous-period comparisons, chart visibility controls, and PDF export.
2. Compare reason breakdowns with actual saved no-purchase records and confirm the charts remain legible on mobile.
3. Verify the manual backup flow separately before treating it as production-ready. The `manual-footfall-backup` Edge Function is active in **staging**; the Production Supabase project currently has no function with that name. The manual-backup UI therefore remains a known Production blocker until the Production function and its required GitHub workflow token/secrets are deliberately configured and tested.
4. Confirm the existing daily scheduled CSV email continues working; do not alter its schedule as part of analytics integration.

## Current status
- Integration is isolated to this release branch and is not merged into `main`.
- No Production database, environment, or deployment has been changed.
- Do not merge or deploy until interactive Preview testing is complete and the manual-backup release decision is made.
