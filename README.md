# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Database migrations

Database changes are stored in `drizzle/migrations`. Configure
`LOVABLE_DB_MIGRATION_URL` for the intended database, then apply pending
migrations with:

```sh
npx drizzle-kit migrate
```

Review and back up the target database before applying migrations to production.

The administrator category and notification features are added by
`0005_admin_categories_notifications.sql`. Broadcasts are stored once and served
from a persistent in-app feed with per-user read receipts; sending does not
depend on an external email or push-notification provider. Category deletion is
archival and requires reassignment when products are linked to that category.

The `0006_repair_marketplace_admin_assignment.sql` migration rechecks the
existing `bestplugmarketplace@gmail.com` Supabase Auth account and idempotently
assigns its database UUID the `admin` role. If the account did not exist when
the migration ran, create/sign in to the existing account first, then run this
targeted operation in the Supabase SQL Editor (the account must have a verified
email):

```sql
DO $$
DECLARE
  target_user_id uuid;
  matching_users integer;
BEGIN
  SELECT count(*) INTO matching_users
  FROM auth.users
  WHERE lower(email) = 'bestplugmarketplace@gmail.com'
    AND email_confirmed_at IS NOT NULL;

  IF matching_users <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one verified Auth account for bestplugmarketplace@gmail.com; found %.', matching_users;
  END IF;

  SELECT id INTO target_user_id
  FROM auth.users
  WHERE lower(email) = 'bestplugmarketplace@gmail.com'
    AND email_confirmed_at IS NOT NULL;

  INSERT INTO public.profiles (id, email)
  SELECT id, email
  FROM auth.users
  WHERE id = target_user_id
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
```

The dashboard checks the signed-in user's `admin` role through the baseline
`public.has_role(uuid, app_role)` RPC and confirms the user's own profile is
active. Server-side admin operations repeat the role check using the user ID
from the verified session; they never trust a browser-supplied email or ID.

The `0008_repair_admin_authentication.sql` migration reinstalls the
`public.is_active_admin(uuid)` RPC used by admin database policies and newer
admin functions, restricts execution to authenticated/service roles, safely
assigns the `admin` role to the one existing verified
`bestplugmarketplace@gmail.com` Auth account (if present), and requests a
PostgREST schema-cache reload. If applying SQL manually instead of using the
migration runner, execute that migration in the intended Supabase project's SQL
Editor.
You can confirm the installed signature with:

```sql
SELECT n.nspname, p.proname,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS result
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'is_active_admin';
```

The expected signature is `_user_id uuid` returning `boolean`. Then verify the
RPC from the deployed app while authenticated as an administrator. If it still
returns `PGRST202`, confirm `public` is included in the Supabase project's
exposed API schemas and run `NOTIFY pgrst, 'reload schema';` using an authorized
database connection. Migration 0008 does not create or alter an Auth account or
its password; if the account was not verified when it ran, verify the existing
account and rerun the migration or the targeted role-assignment SQL above.

This operation grants the role only to the matching existing Auth UUID. It
does not create an Auth account or allow users to change their own role.
