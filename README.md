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

## Admin-token password change flow

Both the dashboard's **Change password** form and the **Forgot password** recovery flow require an admin-issued token before a new password can be saved. Both flows call the `authorize-password-change` Supabase Edge Function, which validates the token on the server. The token must never be added to Vite variables, source code, or a client-side file.

Before using this feature:

1. Deploy `supabase/functions/authorize-password-change/index.ts` as an Edge Function named `authorize-password-change` in the connected Supabase project. Keep JWT verification enabled.
2. In Supabase Dashboard, open **Edge Functions → Secrets** and set `ADMIN_PASSWORD_CHANGE_TOKEN` to a randomly generated secret of at least 32 characters. Share it only with the administrator and authorized staff who need it.
3. Test a password change with the correct token, then test again with an incorrect token. Confirm the password is unchanged after the failed attempt.
4. To rotate a lost or exposed token, replace the secret in Supabase Edge Function secrets and redeploy/restart the function if the dashboard requires it. The old token should stop working.

The Forgot password flow still sends Supabase's normal recovery email first. After the user opens the recovery link, they must provide the admin token to complete the password update.

**Security limitation:** this token protects both password-change routes in this app. Supabase's hosted Auth API may still permit password changes through other routes outside the app. This is a simple app-level authorization gate, not a guarantee that every possible Auth API password update requires the token.

