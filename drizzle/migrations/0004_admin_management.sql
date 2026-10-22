CREATE TYPE public.product_status AS ENUM ('draft', 'published', 'unavailable');

ALTER TABLE public.profiles
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN suspension_reason text;

ALTER TABLE public.products
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN product_status public.product_status NOT NULL DEFAULT 'draft';

UPDATE public.products
SET product_status = CASE
  WHEN published AND stock > 0 THEN 'published'::public.product_status
  WHEN published THEN 'unavailable'::public.product_status
  ELSE 'draft'::public.product_status
END;

CREATE INDEX profiles_created_at_idx ON public.profiles(created_at DESC);
CREATE INDEX products_admin_created_idx ON public.products(created_at DESC);
CREATE INDEX activity_logs_target_created_idx ON public.activity_logs(target, created_at DESC);

CREATE TABLE public.admin_inventory_requests (
  reference uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  credential_id uuid NOT NULL REFERENCES public.product_credentials(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_inventory_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_inventory_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_inventory_requests TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_marketplace_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(COALESCE(NEW.email, ''), '@', 1)),
    NEW.created_at
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_marketplace_profile() FROM PUBLIC, anon, authenticated;

INSERT INTO public.profiles (id, email, display_name, created_at)
SELECT
  id,
  email,
  COALESCE(raw_user_meta_data->>'display_name', split_part(COALESCE(email, ''), '@', 1)),
  created_at
FROM auth.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'user' FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass
      AND tgname = 'on_auth_user_created'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.ensure_marketplace_profile();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_account_active(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = _user_id
      AND (_user_id = auth.uid() OR auth.role() = 'service_role')
      AND NOT suspended
      AND deleted_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.is_account_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_active(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_active_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = _user_id
      AND (_user_id = auth.uid() OR auth.role() = 'service_role')
      AND r.role = 'admin'
      AND NOT p.suspended
      AND p.deleted_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.is_active_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_admin(uuid) TO authenticated, service_role;

DROP POLICY roles_read_self ON public.user_roles;
CREATE POLICY roles_read_self ON public.user_roles FOR SELECT TO authenticated
  USING ((user_id = auth.uid() AND public.is_account_active(auth.uid()))
    OR public.is_active_admin(auth.uid()));

DROP POLICY profiles_read_self ON public.profiles;
CREATE POLICY profiles_read_self ON public.profiles FOR SELECT TO authenticated
  USING ((id = auth.uid() AND public.is_account_active(auth.uid()))
    OR public.is_active_admin(auth.uid()));

DROP POLICY profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() AND public.is_account_active(auth.uid()))
  WITH CHECK (id = auth.uid() AND public.is_account_active(auth.uid()));

DROP POLICY wallets_read_self ON public.wallets;
CREATE POLICY wallets_read_self ON public.wallets FOR SELECT TO authenticated
  USING ((user_id = auth.uid() AND public.is_account_active(auth.uid()))
    OR public.is_active_admin(auth.uid()));

DROP POLICY transactions_read_self ON public.wallet_transactions;
CREATE POLICY transactions_read_self ON public.wallet_transactions FOR SELECT TO authenticated
  USING ((user_id = auth.uid() AND public.is_account_active(auth.uid()))
    OR public.is_active_admin(auth.uid()));

DROP POLICY payment_intents_read_self ON public.payment_intents;
CREATE POLICY payment_intents_read_self ON public.payment_intents FOR SELECT TO authenticated
  USING ((user_id = auth.uid() AND public.is_account_active(auth.uid()))
    OR public.is_active_admin(auth.uid()));

DROP POLICY categories_admin_write ON public.product_categories;
CREATE POLICY categories_admin_write ON public.product_categories FOR ALL TO authenticated
  USING (public.is_active_admin(auth.uid()))
  WITH CHECK (public.is_active_admin(auth.uid()));

DROP POLICY products_public_read ON public.products;
CREATE POLICY products_public_read ON public.products FOR SELECT TO anon, authenticated
  USING ((published AND archived_at IS NULL) OR public.is_active_admin(auth.uid()));

DROP POLICY products_admin_write ON public.products;
CREATE POLICY products_admin_write ON public.products FOR ALL TO authenticated
  USING (public.is_active_admin(auth.uid()))
  WITH CHECK (public.is_active_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.products FROM authenticated;

DROP POLICY orders_read_self ON public.orders;
CREATE POLICY orders_read_self ON public.orders FOR SELECT TO authenticated
  USING ((user_id = auth.uid() AND public.is_account_active(auth.uid()))
    OR public.is_active_admin(auth.uid()));

DROP POLICY orders_admin_update ON public.orders;
CREATE POLICY orders_admin_update ON public.orders FOR UPDATE TO authenticated
  USING (public.is_active_admin(auth.uid()))
  WITH CHECK (public.is_active_admin(auth.uid()));

DROP POLICY order_items_read_owner ON public.order_items;
CREATE POLICY order_items_read_owner ON public.order_items FOR SELECT TO authenticated
  USING (
    public.is_account_active(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id AND o.user_id = auth.uid()
    )
  );

DROP POLICY credentials_read_assigned ON public.product_credentials;
CREATE POLICY credentials_read_assigned ON public.product_credentials FOR SELECT TO authenticated
  USING (assigned_to = auth.uid() AND public.is_account_active(auth.uid()));

DROP POLICY settings_admin_access ON public.site_settings;
CREATE POLICY settings_admin_access ON public.site_settings FOR ALL TO authenticated
  USING (public.is_active_admin(auth.uid()))
  WITH CHECK (public.is_active_admin(auth.uid()));

DROP POLICY activity_logs_admin_read ON public.activity_logs;
CREATE POLICY activity_logs_admin_read ON public.activity_logs FOR SELECT TO authenticated
  USING (public.is_active_admin(auth.uid()));

DROP POLICY cart_owner ON public.cart_items;
CREATE POLICY cart_owner ON public.cart_items FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_account_active(auth.uid()))
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_account_active(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_id
        AND p.published
        AND p.product_status = 'published'
        AND p.archived_at IS NULL
        AND p.stock > 0
    )
  );

CREATE OR REPLACE FUNCTION public.ensure_user_wallet()
RETURNS TABLE(id uuid, balance numeric, currency text, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.is_account_active(v_user_id) THEN
    RAISE EXCEPTION 'Account suspended or deactivated';
  END IF;

  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    v_user_id,
    auth.jwt()->>'email',
    COALESCE(auth.jwt()->'user_metadata'->>'display_name', split_part(COALESCE(auth.jwt()->>'email', ''), '@', 1))
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();
  INSERT INTO public.wallets (user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_user_id, 'user') ON CONFLICT (user_id, role) DO NOTHING;

  RETURN QUERY
  SELECT w.id, w.balance, w.currency, w.updated_at
  FROM public.wallets w
  WHERE w.user_id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_with_wallet(_product_id uuid, _quantity integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u uuid := auth.uid();
  p public.products;
  w public.wallets;
  total numeric;
  tx uuid;
  ord uuid;
  ids uuid[];
  delivery text;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.is_account_active(u) THEN RAISE EXCEPTION 'Account suspended or deactivated'; END IF;
  IF _quantity IS NULL OR _quantity < 1 OR _quantity > 20 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;

  SELECT * INTO p
  FROM public.products
  WHERE id = _product_id
    AND published
    AND product_status = 'published'
    AND archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR p.stock < _quantity THEN RAISE EXCEPTION 'Product is unavailable'; END IF;

  SELECT * INTO w FROM public.wallets WHERE user_id = u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF w.currency <> p.currency THEN RAISE EXCEPTION 'Currency mismatch'; END IF;
  total := p.price * _quantity;
  IF w.balance < total THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;

  SELECT array_agg(c.id) INTO ids
  FROM (
    SELECT id
    FROM public.product_credentials
    WHERE product_id = _product_id AND order_id IS NULL
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT _quantity
  ) c;
  IF COALESCE(cardinality(ids), 0) < _quantity THEN RAISE EXCEPTION 'Product is currently out of stock'; END IF;

  UPDATE public.wallets SET balance = balance - total, updated_at = now()
  WHERE id = w.id RETURNING balance INTO w.balance;
  UPDATE public.products
  SET stock = stock - _quantity,
      product_status = CASE WHEN stock - _quantity = 0 THEN 'unavailable'::public.product_status ELSE product_status END,
      updated_at = now()
  WHERE id = p.id;
  INSERT INTO public.wallet_transactions(wallet_id, user_id, type, amount, balance_after, status, provider, reference, description)
  VALUES (w.id, u, 'debit', total, w.balance, 'success', 'manual', 'purchase-' || gen_random_uuid()::text, 'Purchase: ' || p.title)
  RETURNING id INTO tx;
  INSERT INTO public.orders(user_id, total, currency, status, wallet_tx_id)
  VALUES (u, total, p.currency, 'completed', tx) RETURNING id INTO ord;

  UPDATE public.product_credentials
  SET order_id = ord, assigned_to = u, delivered_at = now()
  WHERE id = ANY(ids);
  SELECT string_agg(content, E'\n---\n' ORDER BY created_at)
  INTO delivery FROM public.product_credentials WHERE id = ANY(ids);
  INSERT INTO public.order_items(order_id, product_id, title, unit_price, quantity, delivered_payload)
  VALUES (ord, p.id, p.title, p.price, _quantity, delivery);
  RETURN ord;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_cart_order(_user uuid, _request uuid, _external boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ord uuid;
  w public.wallets;
  r record;
  total numeric := 0;
  ids uuid[];
  tx uuid;
  ref text;
BEGIN
  SELECT id INTO ord FROM public.orders WHERE request_key = _request AND user_id = _user;
  IF FOUND THEN RETURN ord; END IF;
  IF NOT public.is_account_active(_user) THEN RAISE EXCEPTION 'Account suspended or deactivated'; END IF;

  SELECT * INTO w FROM public.wallets WHERE user_id = _user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  SELECT id INTO ord FROM public.orders WHERE request_key = _request AND user_id = _user;
  IF FOUND THEN RETURN ord; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cart_items WHERE user_id = _user) THEN RAISE EXCEPTION 'Your cart is empty'; END IF;

  FOR r IN
    SELECT p.id, p.title, p.price, p.stock, p.published, p.product_status, p.archived_at, p.currency, c.quantity
    FROM public.cart_items c
    JOIN public.products p ON p.id = c.product_id
    WHERE c.user_id = _user
    ORDER BY p.id
    FOR UPDATE OF p, c
  LOOP
    IF NOT r.published OR r.product_status <> 'published' OR r.archived_at IS NOT NULL
      OR r.currency <> 'NGN' OR r.stock < r.quantity OR r.quantity NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'An item is unavailable or exceeds stock';
    END IF;
    total := total + r.price * r.quantity;
  END LOOP;
  IF total <= 0 THEN RAISE EXCEPTION 'Invalid order total'; END IF;
  IF NOT _external AND w.balance < total THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;

  ref := 'bp-' || _request::text;
  INSERT INTO public.orders(user_id, total, currency, status, request_key, payment_reference)
  VALUES (_user, total, 'NGN', 'pending', _request, ref)
  RETURNING id INTO ord;

  FOR r IN
    SELECT p.*, c.quantity
    FROM public.cart_items c
    JOIN public.products p ON p.id = c.product_id
    WHERE c.user_id = _user
    ORDER BY p.id
  LOOP
    SELECT array_agg(t.id) INTO ids
    FROM (
      SELECT id FROM public.product_credentials
      WHERE product_id = r.id AND order_id IS NULL
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT r.quantity
    ) t;
    IF COALESCE(cardinality(ids), 0) < r.quantity THEN RAISE EXCEPTION 'An item has insufficient deliverable inventory'; END IF;
    UPDATE public.product_credentials SET order_id = ord WHERE id = ANY(ids);
    UPDATE public.products
    SET stock = stock - r.quantity,
        product_status = CASE WHEN stock - r.quantity = 0 THEN 'unavailable'::public.product_status ELSE product_status END,
        updated_at = now()
    WHERE id = r.id;
    INSERT INTO public.order_items(order_id, product_id, title, unit_price, quantity)
    VALUES (ord, r.id, r.title, r.price, r.quantity);
  END LOOP;

  IF NOT _external THEN
    UPDATE public.wallets SET balance = balance - total, updated_at = now()
    WHERE id = w.id RETURNING balance INTO w.balance;
    INSERT INTO public.wallet_transactions(wallet_id, user_id, type, amount, balance_after, provider, reference, description)
    VALUES (w.id, _user, 'debit', total, w.balance, 'manual', ref, 'Cart purchase')
    RETURNING id INTO tx;
    UPDATE public.orders SET status = 'completed', wallet_tx_id = tx WHERE id = ord;
    UPDATE public.product_credentials SET assigned_to = _user, delivered_at = now() WHERE order_id = ord;
    UPDATE public.order_items i
    SET delivered_payload = (
      SELECT string_agg(c.content, E'\n---\n' ORDER BY c.created_at)
      FROM public.product_credentials c
      WHERE c.order_id = ord AND c.product_id = i.product_id
    )
    WHERE i.order_id = ord;
    DELETE FROM public.cart_items
    WHERE user_id = _user
      AND product_id IN (SELECT product_id FROM public.order_items WHERE order_id = ord);
  END IF;
  RETURN ord;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_paystack(_reference text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i public.payment_intents;
BEGIN
  SELECT * INTO i
  FROM public.payment_intents
  WHERE reference = _reference AND provider::text = 'paystack'
  FOR UPDATE;
  IF NOT FOUND OR i.status <> 'pending' THEN RETURN; END IF;

  IF i.order_id IS NOT NULL THEN
    UPDATE public.products p
    SET stock = p.stock + oi.quantity,
        product_status = CASE WHEN p.archived_at IS NULL THEN 'published'::public.product_status ELSE p.product_status END,
        published = CASE WHEN p.archived_at IS NULL THEN true ELSE p.published END,
        updated_at = now()
    FROM public.order_items oi
    WHERE oi.order_id = i.order_id AND oi.product_id = p.id;
    UPDATE public.product_credentials SET order_id = NULL
    WHERE order_id = i.order_id AND assigned_to IS NULL;
    UPDATE public.orders SET status = 'failed' WHERE id = i.order_id AND status = 'pending';
  END IF;
  UPDATE public.payment_intents SET status = 'failed', updated_at = now() WHERE id = i.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_search_users(
  _search text,
  _status text,
  _role text,
  _page integer,
  _page_size integer
)
RETURNS TABLE(
  id uuid,
  email text,
  display_name text,
  phone text,
  created_at timestamptz,
  suspended boolean,
  suspension_reason text,
  deleted_at timestamptz,
  role public.app_role,
  balance numeric,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: administrator access required';
  END IF;
  IF _page < 1 OR _page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid pagination'; END IF;
  IF _status NOT IN ('all', 'active', 'suspended', 'deactivated') THEN RAISE EXCEPTION 'Invalid account status'; END IF;
  IF _role NOT IN ('all', 'user', 'admin') THEN RAISE EXCEPTION 'Invalid account role'; END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT
      p.id, p.email, p.display_name, p.phone, p.created_at, p.suspended,
      p.suspension_reason, p.deleted_at,
      CASE WHEN public.has_role(p.id, 'admin') THEN 'admin'::public.app_role ELSE 'user'::public.app_role END AS account_role,
      COALESCE(w.balance, 0::numeric) AS wallet_balance
    FROM public.profiles p
    LEFT JOIN public.wallets w ON w.user_id = p.id
    WHERE (
        COALESCE(_search, '') = ''
        OR COALESCE(p.email, '') ILIKE '%' || _search || '%'
        OR COALESCE(p.display_name, '') ILIKE '%' || _search || '%'
      )
      AND (
        _status = 'all'
        OR (_status = 'active' AND NOT p.suspended AND p.deleted_at IS NULL)
        OR (_status = 'suspended' AND p.suspended AND p.deleted_at IS NULL)
        OR (_status = 'deactivated' AND p.deleted_at IS NOT NULL)
      )
      AND (_role = 'all' OR (_role = 'admin' AND public.has_role(p.id, 'admin'))
        OR (_role = 'user' AND NOT public.has_role(p.id, 'admin')))
  )
  SELECT matched.id, matched.email, matched.display_name, matched.phone, matched.created_at,
    matched.suspended, matched.suspension_reason, matched.deleted_at, matched.account_role,
    matched.wallet_balance, count(*) OVER ()
  FROM matched
  ORDER BY matched.created_at DESC, matched.id
  LIMIT _page_size OFFSET ((_page - 1) * _page_size);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_search_users(text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, text, text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(
  _user_id uuid,
  _action text,
  _amount numeric,
  _reason text,
  _reference uuid
)
RETURNS TABLE(transaction_id uuid, reference text, previous_balance numeric, new_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  w public.wallets;
  existing public.wallet_transactions;
  prior_balance numeric;
  next_balance numeric;
  ledger_reference text := 'admin-wallet-' || _reference::text;
  tx_id uuid;
BEGIN
  IF actor IS NULL OR NOT public.is_active_admin(actor) THEN RAISE EXCEPTION 'Forbidden: administrator access required'; END IF;
  IF _action NOT IN ('credit', 'debit') THEN RAISE EXCEPTION 'Invalid wallet adjustment'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 100000000 OR round(_amount, 2) <> _amount THEN
    RAISE EXCEPTION 'Amount must be between 0.01 and 100000000 NGN with at most two decimal places';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'A reason of 1 to 500 characters is required'; END IF;
  IF _reference IS NULL THEN RAISE EXCEPTION 'An idempotency reference is required'; END IF;

  SELECT * INTO existing
  FROM public.wallet_transactions
  WHERE wallet_transactions.reference = ledger_reference;
  IF FOUND THEN
    IF existing.user_id <> _user_id
      OR existing.type::text <> _action
      OR existing.amount <> _amount
      OR existing.metadata->>'admin_id' <> actor::text
      OR existing.description <> btrim(_reason) THEN
      RAISE EXCEPTION 'Idempotency reference was already used for a different wallet adjustment';
    END IF;
    RETURN QUERY SELECT existing.id, ledger_reference,
      (existing.metadata->>'previous_balance')::numeric, existing.balance_after;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'User account not found or deactivated';
  END IF;
  INSERT INTO public.wallets(user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO w FROM public.wallets WHERE user_id = _user_id FOR UPDATE;
  prior_balance := w.balance;
  IF _action = 'debit' AND _amount > prior_balance THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;
  next_balance := CASE WHEN _action = 'credit' THEN prior_balance + _amount ELSE prior_balance - _amount END;

  UPDATE public.wallets SET balance = next_balance, updated_at = now() WHERE id = w.id;
  INSERT INTO public.wallet_transactions(
    wallet_id, user_id, type, amount, balance_after, status, provider, reference, description, metadata
  )
  VALUES (
    w.id, _user_id, _action::public.tx_type, _amount, next_balance, 'success', 'manual',
    ledger_reference, btrim(_reason),
    jsonb_build_object(
      'admin_id', actor, 'affected_user_id', _user_id, 'action', _action,
      'previous_balance', prior_balance, 'new_balance', next_balance, 'reason', btrim(_reason)
    )
  )
  RETURNING id INTO tx_id;

  INSERT INTO public.activity_logs(actor_id, action, target, metadata)
  VALUES (
    actor, 'admin.wallet.' || _action, _user_id::text,
    jsonb_build_object(
      'transaction_id', tx_id, 'reference', ledger_reference, 'amount', _amount,
      'previous_balance', prior_balance, 'new_balance', next_balance, 'reason', btrim(_reason)
    )
  );
  RETURN QUERY SELECT tx_id, ledger_reference, prior_balance, next_balance;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_adjust_wallet(uuid, text, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet(uuid, text, numeric, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_user_state(_user_id uuid, _action text, _reason text DEFAULT '')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  target_profile public.profiles;
  currently_active boolean;
  active_admins bigint;
  action_name text;
BEGIN
  IF actor IS NULL OR NOT public.is_active_admin(actor) THEN RAISE EXCEPTION 'Forbidden: administrator access required'; END IF;
  IF _user_id IS NULL OR _user_id = actor THEN RAISE EXCEPTION 'Administrators cannot suspend, deactivate, or restore their own account'; END IF;
  IF _action NOT IN ('suspend', 'restore', 'deactivate') THEN RAISE EXCEPTION 'Invalid account action'; END IF;
  IF _action IN ('suspend', 'deactivate') AND length(btrim(COALESCE(_reason, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'A reason of 1 to 500 characters is required';
  END IF;

  PERFORM pg_advisory_xact_lock(734211, 1);
  SELECT * INTO target_profile FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User account not found'; END IF;
  currently_active := NOT target_profile.suspended AND target_profile.deleted_at IS NULL;

  IF _action = 'suspend' AND target_profile.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Reactivate the deactivated account before suspending it';
  END IF;
  IF _action = 'restore' AND currently_active THEN RETURN false; END IF;
  IF _action = 'suspend' AND target_profile.suspended AND target_profile.deleted_at IS NULL THEN RETURN false; END IF;
  IF _action = 'deactivate' AND target_profile.deleted_at IS NOT NULL THEN RETURN false; END IF;

  IF _action IN ('suspend', 'deactivate') AND currently_active AND public.has_role(_user_id, 'admin') THEN
    SELECT count(*) INTO active_admins
    FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.role = 'admin' AND NOT p.suspended AND p.deleted_at IS NULL;
    IF active_admins <= 1 THEN RAISE EXCEPTION 'The last active administrator cannot be suspended or deactivated'; END IF;
  END IF;

  IF _action = 'restore' THEN
    UPDATE public.profiles
    SET suspended = false, suspension_reason = NULL, deleted_at = NULL, updated_at = now()
    WHERE id = _user_id;
    action_name := 'admin.user.restored';
  ELSIF _action = 'suspend' THEN
    UPDATE public.profiles
    SET suspended = true, suspension_reason = btrim(_reason), updated_at = now()
    WHERE id = _user_id;
    action_name := 'admin.user.suspended';
  ELSE
    UPDATE public.profiles
    SET suspended = true, suspension_reason = btrim(_reason), deleted_at = now(), updated_at = now()
    WHERE id = _user_id;
    action_name := 'admin.user.deactivated';
  END IF;

  INSERT INTO public.activity_logs(actor_id, action, target, metadata)
  VALUES (
    actor, action_name, _user_id::text,
    jsonb_build_object(
      'reason', CASE WHEN _action = 'restore' THEN NULL ELSE btrim(_reason) END,
      'previous_status', CASE
        WHEN target_profile.deleted_at IS NOT NULL THEN 'deactivated'
        WHEN target_profile.suspended THEN 'suspended'
        ELSE 'active'
      END,
      'new_status', CASE
        WHEN _action = 'restore' THEN 'active'
        WHEN _action = 'deactivate' THEN 'deactivated'
        ELSE 'suspended'
      END
    )
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_user_state(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_state(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_product(
  _product_id uuid,
  _title text,
  _slug text,
  _category_id uuid,
  _description text,
  _price numeric,
  _stock integer,
  _image_url text,
  _status public.product_status,
  _metadata jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  current_product public.products;
  product_id uuid;
  available_credentials bigint;
  previous_values jsonb;
  next_values jsonb;
  safe_metadata jsonb;
  old_image_url text;
  linked_orders bigint;
BEGIN
  IF actor IS NULL OR NOT public.is_active_admin(actor) THEN RAISE EXCEPTION 'Forbidden: administrator access required'; END IF;
  IF length(btrim(COALESCE(_title, ''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Product name must be 1 to 160 characters'; END IF;
  IF length(btrim(COALESCE(_slug, ''))) NOT BETWEEN 1 AND 180 OR _slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Invalid product slug';
  END IF;
  IF _price IS NULL OR _price <= 0 OR _price > 100000000 OR round(_price, 2) <> _price THEN RAISE EXCEPTION 'Invalid product price'; END IF;
  IF _stock IS NULL OR _stock < 0 OR _stock > 1000000 THEN RAISE EXCEPTION 'Invalid product stock'; END IF;
  IF _status IS NULL OR _metadata IS NULL OR jsonb_typeof(_metadata) <> 'object' THEN RAISE EXCEPTION 'Invalid product details'; END IF;
  IF _category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.product_categories WHERE id = _category_id) THEN
    RAISE EXCEPTION 'Selected category does not exist';
  END IF;
  IF _image_url IS NOT NULL AND (_image_url !~* '^https?://' OR length(_image_url) > 2048) THEN RAISE EXCEPTION 'Product image must be an HTTP or HTTPS URL'; END IF;

  IF _product_id IS NULL THEN
    product_id := gen_random_uuid();
    previous_values := NULL;
    old_image_url := NULL;
    safe_metadata := _metadata;
  ELSE
    SELECT * INTO current_product FROM public.products WHERE id = _product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF current_product.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore this archived product before editing it'; END IF;
    product_id := current_product.id;
    old_image_url := current_product.image_url;
    safe_metadata := (current_product.metadata - 'specifications' - 'delivery_instructions') || _metadata;
    previous_values := jsonb_build_object(
      'title', current_product.title, 'category_id', current_product.category_id,
      'description', current_product.description, 'price', current_product.price,
      'stock', current_product.stock, 'status', current_product.product_status,
        'image_url', current_product.image_url,
        'specifications', current_product.metadata->'specifications',
        'delivery_instructions_set', length(COALESCE(current_product.metadata->>'delivery_instructions', '')) > 0
    );
  END IF;

  IF _product_id IS NOT NULL THEN
    SELECT count(*) INTO available_credentials
    FROM public.product_credentials
    WHERE product_credentials.product_id = _product_id AND order_id IS NULL;
  ELSE
    available_credentials := 0;
  END IF;
  IF _stock > available_credentials AND (_product_id IS NULL OR _stock <> current_product.stock) THEN
    RAISE EXCEPTION 'Add delivery inventory before increasing sellable stock';
  END IF;
  IF _status = 'published' AND (_stock = 0 OR _stock > available_credentials) THEN
    RAISE EXCEPTION 'A published product needs available delivery inventory';
  END IF;

  INSERT INTO public.products(
    id, title, slug, category_id, description, price, stock, image_url, currency,
    published, product_status, metadata, archived_at, updated_at
  )
  VALUES (
    product_id, btrim(_title), _slug, _category_id, NULLIF(btrim(COALESCE(_description, '')), ''),
    _price, _stock, _image_url, 'NGN', _status <> 'draft', _status, safe_metadata, NULL, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, slug = EXCLUDED.slug, category_id = EXCLUDED.category_id,
    description = EXCLUDED.description, price = EXCLUDED.price, stock = EXCLUDED.stock,
    image_url = EXCLUDED.image_url, published = EXCLUDED.published,
    product_status = EXCLUDED.product_status, metadata = EXCLUDED.metadata, updated_at = now();

  next_values := jsonb_build_object(
    'title', btrim(_title), 'category_id', _category_id, 'description', NULLIF(btrim(COALESCE(_description, '')), ''),
    'price', _price, 'stock', _stock, 'status', _status, 'image_url', _image_url,
    'specifications', safe_metadata->'specifications',
    'delivery_instructions_set', length(COALESCE(safe_metadata->>'delivery_instructions', '')) > 0
  );
  INSERT INTO public.activity_logs(actor_id, action, target, metadata)
  VALUES (
    actor,
    CASE
      WHEN _product_id IS NULL THEN 'admin.product.created'
      WHEN current_product.category_id IS DISTINCT FROM _category_id THEN 'admin.product.category_changed'
      WHEN current_product.price IS DISTINCT FROM _price THEN 'admin.product.price_changed'
      WHEN current_product.stock IS DISTINCT FROM _stock THEN 'admin.product.stock_changed'
      WHEN current_product.published IS DISTINCT FROM (_status <> 'draft') THEN
        CASE WHEN _status = 'draft' THEN 'admin.product.unpublished' ELSE 'admin.product.published' END
      WHEN current_product.product_status IS DISTINCT FROM _status THEN 'admin.product.status_changed'
      ELSE 'admin.product.updated'
    END,
    product_id::text,
    jsonb_build_object(
      'before', previous_values,
      'after', next_values,
      'changes', jsonb_build_object(
        'name_changed', current_product.title IS DISTINCT FROM btrim(_title),
        'description_changed', current_product.description IS DISTINCT FROM NULLIF(btrim(COALESCE(_description, '')), ''),
        'category_changed', current_product.category_id IS DISTINCT FROM _category_id,
        'price_changed', current_product.price IS DISTINCT FROM _price,
        'stock_changed', current_product.stock IS DISTINCT FROM _stock,
        'image_changed', old_image_url IS DISTINCT FROM _image_url,
        'publication_changed', current_product.published IS DISTINCT FROM (_status <> 'draft'),
        'status_changed', current_product.product_status IS DISTINCT FROM _status,
        'specifications_changed', current_product.metadata->'specifications' IS DISTINCT FROM safe_metadata->'specifications',
        'delivery_instructions_changed', current_product.metadata->>'delivery_instructions' IS DISTINCT FROM safe_metadata->>'delivery_instructions'
      )
    )
  );
  RETURN product_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_save_product(uuid, text, text, uuid, text, numeric, integer, text, public.product_status, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_product(uuid, text, text, uuid, text, numeric, integer, text, public.product_status, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_archive_product(_product_id uuid, _archived boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  current_product public.products;
linked_orders bigint;
BEGIN
  IF actor IS NULL OR NOT public.is_active_admin(actor) THEN RAISE EXCEPTION 'Forbidden: administrator access required'; END IF;
  SELECT * INTO current_product FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF (_archived AND current_product.archived_at IS NOT NULL)
    OR (NOT _archived AND current_product.archived_at IS NULL) THEN RETURN false; END IF;

  IF _archived THEN
    UPDATE public.products SET archived_at = now(), published = false, updated_at = now() WHERE id = _product_id;
  ELSE
    UPDATE public.products
    SET archived_at = NULL,
        published = product_status <> 'draft',
        updated_at = now()
    WHERE id = _product_id;
  END IF;

  SELECT count(*) INTO linked_orders
  FROM public.order_items
  WHERE product_id = _product_id;

  INSERT INTO public.activity_logs(actor_id, action, target, metadata)
  VALUES (
    actor,
    CASE WHEN _archived THEN 'admin.product.archived' ELSE 'admin.product.restored' END,
    _product_id::text,
    jsonb_build_object(
      'title', current_product.title, 'price', current_product.price,
      'stock', current_product.stock, 'previous_archived_at', current_product.archived_at,
      'linked_order_count', linked_orders
    )
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_archive_product(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_archive_product(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_inventory_count(_product_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden: administrator access required'; END IF;
  RETURN (
    SELECT count(*) FROM public.product_credentials
    WHERE product_id = _product_id AND order_id IS NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_inventory_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_inventory_count(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_product_order_counts(_product_ids uuid[])
RETURNS TABLE(product_id uuid, order_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden: administrator access required'; END IF;
  RETURN QUERY
  SELECT requested.id, count(oi.id)
  FROM unnest(_product_ids) AS requested(id)
  LEFT JOIN public.order_items oi ON oi.product_id = requested.id
  GROUP BY requested.id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_product_order_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_product_order_counts(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_add_product_credential(_product_id uuid, _content text, _reference uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  existing public.admin_inventory_requests;
  credential_id uuid;
  new_stock integer;
  current_product public.products;
BEGIN
  IF actor IS NULL OR NOT public.is_active_admin(actor) THEN RAISE EXCEPTION 'Forbidden: administrator access required'; END IF;
  IF _reference IS NULL THEN RAISE EXCEPTION 'An idempotency reference is required'; END IF;
  IF _content IS NULL OR length(btrim(_content)) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'A delivery record of 1 to 10000 characters is required'; END IF;

  SELECT * INTO existing FROM public.admin_inventory_requests WHERE reference = _reference;
  IF FOUND THEN
    IF existing.product_id <> _product_id OR existing.actor_id <> actor THEN
      RAISE EXCEPTION 'Idempotency reference was already used for another inventory update';
    END IF;
    RETURN (SELECT stock FROM public.products WHERE id = _product_id);
  END IF;

  SELECT * INTO current_product FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND OR current_product.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Product is missing or archived'; END IF;
  IF current_product.stock >= 1000000 THEN RAISE EXCEPTION 'Product inventory limit reached'; END IF;

  INSERT INTO public.product_credentials(product_id, content)
  VALUES (_product_id, btrim(_content))
  RETURNING id INTO credential_id;
  UPDATE public.products SET stock = stock + 1, updated_at = now()
  WHERE id = _product_id RETURNING stock INTO new_stock;
  INSERT INTO public.admin_inventory_requests(reference, product_id, actor_id, credential_id)
  VALUES (_reference, _product_id, actor, credential_id);
  INSERT INTO public.activity_logs(actor_id, action, target, metadata)
  VALUES (
    actor, 'admin.product.inventory_added', _product_id::text,
    jsonb_build_object('inventory_count', 1, 'new_stock', new_stock, 'reference', _reference)
  );
  RETURN new_stock;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_add_product_credential(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_product_credential(uuid, text, uuid) TO authenticated;
