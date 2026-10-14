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
- Unavailable-item migrations are a separate feature dependency. They are included in this release branch so the unavailable-items entry and register can be reviewed together, but they have not been applied to any database by this work.

## Changes on the integration branch
- Ported only `src/components/AdminAnalytics.tsx` and the dedicated `src/components/AdminAnalytics.css`.
- Added `jspdf ^3.0.1` to `package.json`. There is no `package-lock.json` on `main`.
- Adapted outcome typing and conversion denominators for undecided visits.
- Ensured undecided visits appear in outcome distribution and daily stacked charts.
- Lazy-loaded the PDF export dependency so PDF-generation code is requested only when needed. The verified build's main JS chunk fell from 876.65 KB to 485.12 KB (391.53 KB, about 44.7% smaller); the 388.48 KB jsPDF chunk is now separate from the initial chunk.
- Clarified conversion labels to say that conversion is based on resolved visits (purchased or no purchase).
- Corrected branch no-purchase-rate denominator to exclude undecided visits.
- Kept unrelated global styling and other development-branch features out of this integration; copied only the unavailable-items styles required by the register and recent-visit completion flow.

## Unavailable-items feature now included
- Added the staff entry prompt for recording the unavailable product name and an optional JPG/PNG/WebP photo (up to 5 MB).
- When staff chooses the "Item unavailable" no-purchase reason, the product details prompt opens; "Purchased, but requested item unavailable" also opens it.
- Visit and product details are saved together through the `record_unavailable_item` database function when details are provided.
- If staff closes the prompt for later, the visit is still recorded with an outstanding product-details marker. Recent visits lets staff add the product details later.
- Added the shared unavailable-items register for staff and admins, with search, branch/date filters, optional photo viewing, name correction, and CSV export. Admins can update assessment status and bulk-mark reports reviewed/resolved.
- Added the three unavailable-items SQL migrations to this release branch. These are code files only; no database migration was applied by this work.
- Read-only inspection confirms the staging database already has `public.unavailable_items` (11 rows) and migration records for the register and photo protections. Production has not been modified.
- The feature was restored to the release scope after it was incorrectly omitted in the first integration pass.

## Build verification
- Vercel Preview build is **READY** for the current integration branch, including analytics and unavailable-item entry/register.
- Latest Preview URL: https://pharmacy-footfall-tracker-qsht2bsbd-uvothemans-projects.vercel.app
- Verified code build commit: `c21a9c1869e5a50c2791a46cf43a72c5370ce991` (unavailable-item feature wired into the app and both outcomes correctly flagged). The subsequent audit-document commit also built successfully.
- An earlier intermediate build failed due to a missing closing JSX brace in the undecided chart segment. That was fixed before the successful build.
- The Vercel web page could not be inspected through the available browser/search view. Interactive Preview testing remains required.

## Remaining release checks
1. In Preview, test all four analytics tabs, 7/30/90-day presets, custom date ranges, branch filtering, previous-period comparisons, chart visibility controls, and PDF export.
2. Compare reason breakdowns with actual saved no-purchase records and confirm the charts remain legible on mobile.
3. Verify the manual backup flow separately before treating it as production-ready. The `manual-footfall-backup` Edge Function is active in **staging**; the Production Supabase project currently has no function with that name. The manual-backup UI therefore remains a known Production blocker until the Production function and its required GitHub workflow token/secrets are deliberately configured and tested.
4. Confirm the existing daily scheduled CSV email continues working; do not alter its schedule as part of analytics integration.

## Current status
- Integration is isolated to this release branch and is not merged into `main`.
- No Production database, environment, or deployment has been changed.
- Do not merge or deploy until interactive Preview testing covers analytics and unavailable-item entry/register, and the manual-backup release decision is made.
