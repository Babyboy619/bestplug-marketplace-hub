DO $$
DECLARE
  target_user_id uuid;
  matching_users integer;
BEGIN
  SELECT count(*) INTO matching_users
  FROM auth.users
  WHERE lower(email) = 'bestplugmarketplace@gmail.com';

  IF matching_users = 0 THEN
    RAISE NOTICE 'No existing auth.users account found for bestplugmarketplace@gmail.com; no administrator role was assigned.';
    RETURN;
  END IF;

  IF matching_users > 1 THEN
    RAISE EXCEPTION 'Multiple auth.users accounts match bestplugmarketplace@gmail.com; refusing to assign administrator privileges ambiguously.';
  END IF;

  SELECT id INTO target_user_id
  FROM auth.users
  WHERE lower(email) = 'bestplugmarketplace@gmail.com';

  INSERT INTO public.profiles (id, email)
  SELECT id, email
  FROM auth.users
  WHERE id = target_user_id
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
