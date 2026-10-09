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
