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

NOTIFY pgrst, 'reload schema';
