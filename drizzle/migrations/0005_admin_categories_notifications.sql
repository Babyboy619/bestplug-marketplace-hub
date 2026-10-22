ALTER TABLE public.product_categories
  ADD COLUMN image_url text,
  ADD COLUMN display_order integer NOT NULL DEFAULT 0,
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN deleted_at timestamptz;

CREATE INDEX product_categories_marketplace_order_idx
  ON public.product_categories(display_order, name)
  WHERE is_active AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.require_active_product_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1
  FROM public.product_categories c
  WHERE c.id = NEW.category_id
    AND c.is_active
    AND c.deleted_at IS NULL
  FOR KEY SHARE;
  IF FOUND THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Products can only be assigned to an active category';
END;
$$;
REVOKE ALL ON FUNCTION public.require_active_product_category() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER products_require_active_category
  BEFORE INSERT OR UPDATE OF category_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.require_active_product_category();

CREATE TABLE public.notification_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference uuid NOT NULL UNIQUE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 5000),
  notification_type text NOT NULL CHECK (
    notification_type IN ('general', 'announcement', 'promotion', 'maintenance', 'important')
  ),
  destination_url text CHECK (
    destination_url IS NULL OR (
      destination_url LIKE '/%'
      AND destination_url NOT LIKE '//%'
      AND destination_url !~ '[[:cntrl:]]'
      AND position(chr(92) IN destination_url) = 0
    )
  ),
  status text NOT NULL DEFAULT 'sent' CHECK (status = 'sent'),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  recipient_count integer NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX notification_broadcasts_sent_created_idx
  ON public.notification_broadcasts(created_at DESC)
  WHERE status = 'sent';

CREATE TABLE public.notification_reads (
  notification_id uuid NOT NULL REFERENCES public.notification_broadcasts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX notification_reads_user_idx ON public.notification_reads(user_id, notification_id);

ALTER TABLE public.notification_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.activity_logs FROM authenticated;
REVOKE ALL ON public.notification_broadcasts FROM PUBLIC, anon;
REVOKE ALL ON public.notification_reads FROM PUBLIC, anon;
GRANT SELECT ON public.notification_broadcasts, public.notification_reads TO authenticated;

DROP POLICY categories_public_read ON public.product_categories;
DROP POLICY categories_admin_write ON public.product_categories;
CREATE POLICY categories_visible_read ON public.product_categories FOR SELECT TO anon, authenticated
  USING (
    (is_active AND deleted_at IS NULL)
    OR public.is_active_admin(auth.uid())
  );
REVOKE INSERT, UPDATE, DELETE ON public.product_categories FROM authenticated;

CREATE POLICY notification_broadcasts_read ON public.notification_broadcasts
  FOR SELECT TO authenticated
  USING (status = 'sent' AND public.is_account_active(auth.uid()));
CREATE POLICY notification_broadcasts_admin_read ON public.notification_broadcasts
  FOR SELECT TO authenticated
  USING (public.is_active_admin(auth.uid()));
CREATE POLICY notification_reads_self_read ON public.notification_reads
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_account_active(auth.uid()));
CREATE POLICY notification_reads_self_insert ON public.notification_reads
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_account_active(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.notification_broadcasts n
      WHERE n.id = notification_id AND n.status = 'sent'
    )
  );
REVOKE INSERT, UPDATE, DELETE ON public.notification_broadcasts FROM authenticated;
REVOKE UPDATE, DELETE ON public.notification_reads FROM authenticated;

DROP POLICY products_public_read ON public.products;
CREATE POLICY products_public_read ON public.products FOR SELECT TO anon, authenticated
  USING (
    (
      published
      AND archived_at IS NULL
      AND (
        category_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.product_categories c
          WHERE c.id = products.category_id
            AND c.is_active
            AND c.deleted_at IS NULL
        )
      )
    )
    OR public.is_active_admin(auth.uid())
  );

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
    AND (
      category_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.product_categories c
        WHERE c.id = products.category_id AND c.is_active AND c.deleted_at IS NULL
      )
    )
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
    SELECT p.id, p.title, p.price, p.stock, p.published, p.product_status, p.archived_at, p.currency, p.category_id, c.quantity
    FROM public.cart_items c
    JOIN public.products p ON p.id = c.product_id
    WHERE c.user_id = _user
    ORDER BY p.id
    FOR UPDATE OF p, c
  LOOP
    IF NOT r.published OR r.product_status <> 'published' OR r.archived_at IS NOT NULL
      OR r.currency <> 'NGN' OR r.stock < r.quantity OR r.quantity NOT BETWEEN 1 AND 20
      OR (
        r.category_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.product_categories category
          WHERE category.id = r.category_id AND category.is_active AND category.deleted_at IS NULL
        )
      ) THEN
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

CREATE OR REPLACE FUNCTION public.admin_save_category(
  _category_id uuid,
  _name text,
  _slug text,
  _description text,
  _image_url text,
  _display_order integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  existing public.product_categories;
  category_id uuid;
BEGIN
  IF actor IS NULL OR NOT public.is_active_admin(actor) THEN RAISE EXCEPTION 'Forbidden: administrator access required'; END IF;
  IF length(btrim(COALESCE(_name, ''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Category name must be 1 to 100 characters'; END IF;
  IF length(btrim(COALESCE(_slug, ''))) NOT BETWEEN 1 AND 120 OR _slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN RAISE EXCEPTION 'Invalid category slug'; END IF;
  IF _description IS NOT NULL AND length(_description) > 1000 THEN RAISE EXCEPTION 'Category description is too long'; END IF;
  IF _image_url IS NOT NULL AND (_image_url !~* '^https?://' OR length(_image_url) > 2048) THEN RAISE EXCEPTION 'Category image must be an HTTP or HTTPS URL'; END IF;
  IF _display_order IS NULL OR _display_order NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'Invalid display order'; END IF;

  IF _category_id IS NULL THEN
    INSERT INTO public.product_categories(name, slug, description, image_url, display_order)
    VALUES (btrim(_name), _slug, NULLIF(btrim(COALESCE(_description, '')), ''), _image_url, _display_order)
    RETURNING id INTO category_id;
    INSERT INTO public.activity_logs(actor_id, action, target, metadata)
    VALUES (actor, 'admin.category.created', category_id::text,
      jsonb_build_object('after', jsonb_build_object('name', btrim(_name), 'slug', _slug, 'description', _description, 'image_url', _image_url, 'display_order', _display_order)));
  ELSE
    SELECT * INTO existing FROM public.product_categories WHERE id = _category_id FOR UPDATE;
    IF NOT FOUND OR existing.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Category not found or deleted'; END IF;
    UPDATE public.product_categories
    SET name = btrim(_name), slug = _slug,
        description = NULLIF(btrim(COALESCE(_description, '')), ''),
        image_url = _image_url, display_order = _display_order
    WHERE id = _category_id;
    category_id := _category_id;
    INSERT INTO public.activity_logs(actor_id, action, target, metadata)
    VALUES (actor, 'admin.category.updated', category_id::text,
      jsonb_build_object(
        'before', jsonb_build_object('name', existing.name, 'slug', existing.slug, 'description', existing.description, 'image_url', existing.image_url, 'display_order', existing.display_order),
        'after', jsonb_build_object('name', btrim(_name), 'slug', _slug, 'description', NULLIF(btrim(COALESCE(_description, '')), ''), 'image_url', _image_url, 'display_order', _display_order)
      ));
  END IF;
  RETURN category_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_save_category(uuid, text, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_category(uuid, text, text, text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_search_categories()
RETURNS TABLE(
  id uuid,
  name text,
  slug text,
  description text,
  image_url text,
  display_order integer,
  is_active boolean,
  deleted_at timestamptz,
  created_at timestamptz,
  product_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden: administrator access required'; END IF;
  RETURN QUERY
  SELECT c.id, c.name, c.slug, c.description, c.image_url, c.display_order, c.is_active, c.deleted_at, c.created_at, count(p.id)
  FROM public.product_categories c
  LEFT JOIN public.products p ON p.category_id = c.id
  GROUP BY c.id
  ORDER BY c.deleted_at NULLS FIRST, c.display_order, c.name;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_search_categories() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_categories() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_category_state(
  _category_id uuid,
  _action text,
  _reassign_to uuid DEFAULT NULL
)
RETURNS TABLE(changed boolean, reassigned_products bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  category public.product_categories;
  product_count bigint;
BEGIN
  IF actor IS NULL OR NOT public.is_active_admin(actor) THEN RAISE EXCEPTION 'Forbidden: administrator access required'; END IF;
  IF _action NOT IN ('activate', 'deactivate', 'delete', 'restore') THEN RAISE EXCEPTION 'Invalid category action'; END IF;
  SELECT * INTO category FROM public.product_categories WHERE id = _category_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found'; END IF;

  IF _action = 'restore' THEN
    IF category.deleted_at IS NULL THEN RETURN QUERY SELECT false, 0::bigint; RETURN; END IF;
    UPDATE public.product_categories SET deleted_at = NULL, is_active = false WHERE id = _category_id;
    INSERT INTO public.activity_logs(actor_id, action, target, metadata)
    VALUES (actor, 'admin.category.restored', _category_id::text, jsonb_build_object('name', category.name, 'is_active', false));
    RETURN QUERY SELECT true, 0::bigint;
    RETURN;
  END IF;
  IF category.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Restore the category before changing its status'; END IF;
  IF _action = 'activate' AND category.is_active THEN RETURN QUERY SELECT false, 0::bigint; RETURN; END IF;
  IF _action = 'deactivate' AND NOT category.is_active THEN RETURN QUERY SELECT false, 0::bigint; RETURN; END IF;

  IF _action = 'delete' THEN
    SELECT count(*) INTO product_count FROM public.products WHERE category_id = _category_id;
    IF product_count > 0 THEN
      IF _reassign_to IS NULL OR _reassign_to = _category_id THEN
        RAISE EXCEPTION 'Reassign all % linked products to another active category before deleting', product_count;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.product_categories
        WHERE id = _reassign_to AND is_active AND deleted_at IS NULL
      ) THEN RAISE EXCEPTION 'The reassignment category must be active'; END IF;
      UPDATE public.products SET category_id = _reassign_to, updated_at = now()
      WHERE category_id = _category_id;
    END IF;
    UPDATE public.product_categories SET is_active = false, deleted_at = now() WHERE id = _category_id;
  ELSE
    UPDATE public.product_categories SET is_active = (_action = 'activate') WHERE id = _category_id;
  END IF;

  INSERT INTO public.activity_logs(actor_id, action, target, metadata)
  VALUES (
    actor,
    CASE _action
      WHEN 'activate' THEN 'admin.category.activated'
      WHEN 'deactivate' THEN 'admin.category.deactivated'
      ELSE 'admin.category.deleted'
    END,
    _category_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('name', category.name, 'slug', category.slug, 'is_active', category.is_active, 'deleted_at', category.deleted_at),
      'after', jsonb_build_object('is_active', _action = 'activate', 'deleted_at', CASE WHEN _action = 'delete' THEN now() ELSE NULL END),
      'reassigned_products', CASE WHEN _action = 'delete' THEN product_count ELSE 0 END,
      'reassigned_to', CASE WHEN _action = 'delete' THEN _reassign_to ELSE NULL END
    )
  );
  RETURN QUERY SELECT true, CASE WHEN _action = 'delete' THEN product_count ELSE 0 END;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_category_state(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_category_state(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_broadcast_notification(
  _reference uuid,
  _title text,
  _message text,
  _type text,
  _destination_url text DEFAULT NULL
)
RETURNS TABLE(notification_id uuid, status text, recipient_count integer, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  existing public.notification_broadcasts;
  eligible_count integer;
BEGIN
  IF actor IS NULL OR NOT public.is_active_admin(actor) THEN RAISE EXCEPTION 'Forbidden: administrator access required'; END IF;
  IF _reference IS NULL THEN RAISE EXCEPTION 'An idempotency reference is required'; END IF;
  IF length(btrim(COALESCE(_title, ''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Title must be 1 to 160 characters'; END IF;
  IF length(btrim(COALESCE(_message, ''))) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Message must be 1 to 5000 characters'; END IF;
  IF _type NOT IN ('general', 'announcement', 'promotion', 'maintenance', 'important') THEN RAISE EXCEPTION 'Invalid notification type'; END IF;
  IF _destination_url IS NOT NULL AND (
    length(_destination_url) > 500 OR _destination_url NOT LIKE '/%'
    OR _destination_url LIKE '//%' OR _destination_url ~ '[[:cntrl:]]'
    OR position(chr(92) IN _destination_url) > 0
  ) THEN RAISE EXCEPTION 'Destination must be a safe same-site path'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_reference::text));
  SELECT * INTO existing FROM public.notification_broadcasts WHERE reference = _reference;
  IF FOUND THEN
    IF existing.created_by <> actor
      OR existing.title <> btrim(_title)
      OR existing.message <> btrim(_message)
      OR existing.notification_type <> _type
      OR existing.destination_url IS DISTINCT FROM NULLIF(btrim(_destination_url), '') THEN
      RAISE EXCEPTION 'Broadcast reference was already used for different content';
    END IF;
    RETURN QUERY SELECT existing.id, existing.status, existing.recipient_count, existing.created_at;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO eligible_count
  FROM public.profiles
  WHERE NOT suspended AND deleted_at IS NULL;

  INSERT INTO public.notification_broadcasts(reference, title, message, notification_type, destination_url, status, created_by, recipient_count, sent_at)
  VALUES (_reference, btrim(_title), btrim(_message), _type, NULLIF(btrim(_destination_url), ''), 'sent', actor, eligible_count, now())
  RETURNING id, notification_broadcasts.status, notification_broadcasts.recipient_count, notification_broadcasts.created_at
  INTO notification_id, status, recipient_count, created_at;

  INSERT INTO public.activity_logs(actor_id, action, target, metadata)
  VALUES (
    actor, 'admin.notification.broadcast_sent', notification_id::text,
    jsonb_build_object('reference', _reference, 'type', _type, 'recipient_count', eligible_count, 'status', 'sent')
  );
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_broadcast_notification(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_broadcast_notification(uuid, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_notification_feed(_page integer DEFAULT 1, _page_size integer DEFAULT 20)
RETURNS TABLE(
  id uuid,
  title text,
  message text,
  notification_type text,
  destination_url text,
  created_at timestamptz,
  read_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_user_created_at timestamptz;
BEGIN
  IF current_user_id IS NULL OR NOT public.is_account_active(current_user_id) THEN RAISE EXCEPTION 'Active authentication required'; END IF;
  IF _page < 1 OR _page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid pagination'; END IF;
  SELECT p.created_at INTO current_user_created_at FROM public.profiles p WHERE p.id = current_user_id;
  RETURN QUERY
  SELECT n.id, n.title, n.message, n.notification_type, n.destination_url, n.created_at, r.read_at, count(*) OVER ()
  FROM public.notification_broadcasts n
  LEFT JOIN public.notification_reads r
    ON r.notification_id = n.id AND r.user_id = current_user_id
  WHERE n.status = 'sent'
    AND n.created_at >= current_user_created_at
  ORDER BY n.created_at DESC
  LIMIT _page_size OFFSET ((_page - 1) * _page_size);
END;
$$;
REVOKE ALL ON FUNCTION public.user_notification_feed(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_notification_feed(integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_notification_read(_notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL OR NOT public.is_account_active(current_user_id) THEN RAISE EXCEPTION 'Active authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_broadcasts WHERE id = _notification_id AND status = 'sent') THEN
    RAISE EXCEPTION 'Notification not found';
  END IF;
  INSERT INTO public.notification_reads(notification_id, user_id)
  VALUES (_notification_id, current_user_id)
  ON CONFLICT (notification_id, user_id) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.count_unread_notifications()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_user_created_at timestamptz;
BEGIN
  IF current_user_id IS NULL OR NOT public.is_account_active(current_user_id) THEN RETURN 0; END IF;
  SELECT p.created_at INTO current_user_created_at FROM public.profiles p WHERE p.id = current_user_id;
  RETURN (
    SELECT count(*)
    FROM public.notification_broadcasts n
    WHERE n.status = 'sent'
      AND n.created_at >= current_user_created_at
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_reads r
        WHERE r.notification_id = n.id AND r.user_id = current_user_id
      )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.count_unread_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_unread_notifications() TO authenticated;
