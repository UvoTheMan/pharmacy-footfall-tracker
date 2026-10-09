# Pharmacy Footfall Tracker

A mobile-friendly multi-branch visit counter for Gbagada, Akoka, and Sangotedo.

## Current status

- Stage 1: branch selection, quick visit entry, batch entry, and daily counters.
- Stage 2 code: Supabase authentication/database integration and branch-level row security migration.
- Not yet deployed or connected to a live Supabase project. Visits are not centrally stored until the setup below is completed.
- Audited corrections, reports, scheduled CSV backups, and production deployment are later stages.

## Configure the database

1. Create a Supabase project.
2. Open the SQL Editor and run `supabase/migrations/202610090001_initial_schema.sql`.
3. In Project Settings, find the project URL and publishable/anon key.
4. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Create staff accounts through Supabase Authentication. New users default to the staff role and cannot make themselves admins.
6. Promote the trusted administrator from the SQL Editor using their auth user UUID:
   ```sql
   update public.profiles
   set role = 'admin'
   where user_id = 'YOUR-AUTH-USER-UUID';
   ```
7. Assign staff to their permitted branch or branches. Replace the user UUID and branch slug as needed:
   ```sql
   insert into public.branch_memberships (user_id, branch_id)
   select 'YOUR-STAFF-USER-UUID'::uuid, id
   from public.branches
   where slug = 'gbagada';
   ```
8. Run `npm install` and `npm run dev` locally to test. For deployment, configure the same two Vite environment variables in the hosting provider.

## Security notes

- The browser must only receive the Supabase publishable/anon key. Never place a service-role key in Vite variables or client code.
- Row-level security limits branch data to assigned staff; active admins can access all branches.
- Keep staff account creation controlled by the administrator. Use strong passwords and enable MFA for admin accounts.
- Browser local storage is not a central database and can be cleared by the user. Do not use it as the production source of truth.

## Admin-token password authorization

Both the dashboard's **Change password** form and the **Forgot password** flow require the admin-issued token. The recovery email is not requested until the token is validated by the server, and the token is checked again before a new password is saved. The token must never be added to Vite variables, source code, or a client-side file.

Before using this feature:

1. Deploy `supabase/functions/authorize-password-change/index.ts` as an Edge Function named `authorize-password-change` in the connected Supabase project.
2. In the Edge Function settings, turn **Verify JWT** off for this function. The function needs to accept the unauthenticated recovery-email request, and it manually validates the admin token for both actions. For password updates, it also validates the user's Supabase access token before using the server-only service-role key.
3. In Supabase Dashboard, open **Edge Functions → Secrets** and set `ADMIN_PASSWORD_CHANGE_TOKEN` to a randomly generated secret of at least 32 characters. Keep it private and share it only with people authorized to use it.
4. Test the Forgot password flow with an incorrect token and confirm no recovery email is requested. Then test with the correct token, open the recovery email, and confirm the new password form also rejects an incorrect token.
5. To rotate a lost or exposed token, replace the secret in Supabase Edge Function secrets. The old token should stop working.

**Security note:** turning off the platform's gateway JWT check does not mean password updates are unauthenticated. This function verifies the user access token itself before changing a password. Supabase Auth may still offer routes outside this app, so this remains an app-level authorization gate rather than a guarantee that every possible Auth API route requires the admin token.
