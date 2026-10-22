ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE OR REPLACE FUNCTION public.is_active_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN false
    WHEN auth.role() IS DISTINCT FROM 'service_role'
      AND _user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles AS roles
      JOIN public.profiles AS profile ON profile.id = roles.user_id
      WHERE roles.user_id = _user_id
        AND roles.role = 'admin'
        AND NOT profile.suspended
        AND profile.deleted_at IS NULL
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_active_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_admin(uuid) TO authenticated, service_role;

DO $$
DECLARE
  target_user_id uuid;
  matching_users integer;
BEGIN
  SELECT count(*) INTO matching_users
  FROM auth.users
  WHERE lower(email) = 'bestplugmarketplace@gmail.com'
    AND email_confirmed_at IS NOT NULL;

  IF matching_users = 0 THEN
    RAISE NOTICE 'No existing verified Auth account found for bestplugmarketplace@gmail.com; no administrator role was assigned.';
    RETURN;
  END IF;

  IF matching_users > 1 THEN
    RAISE EXCEPTION 'Multiple verified Auth accounts match bestplugmarketplace@gmail.com; refusing ambiguous administrator assignment.';
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

NOTIFY pgrst, 'reload schema';
