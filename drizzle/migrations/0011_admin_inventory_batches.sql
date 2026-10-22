ALTER TABLE public.product_credentials
  ADD COLUMN IF NOT EXISTS specifications jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS delivery_instructions text NOT NULL DEFAULT '';

ALTER TABLE public.admin_inventory_requests
  ALTER COLUMN credential_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS saved_count integer NOT NULL DEFAULT 1 CHECK (saved_count >= 0);

CREATE OR REPLACE FUNCTION public.admin_inventory_count(_product_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: administrator access required';
  END IF;
  RETURN (
    SELECT count(*) FROM public.product_credentials
    WHERE product_id = _product_id AND order_id IS NULL AND assigned_to IS NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_inventory_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_inventory_count(uuid) TO authenticated;

WITH available_inventory AS (
  SELECT product_id, count(*)::integer AS available_count
  FROM public.product_credentials
  WHERE order_id IS NULL AND assigned_to IS NULL
  GROUP BY product_id
)
UPDATE public.products product
SET stock = COALESCE(available_inventory.available_count, 0),
    product_status = CASE
      WHEN COALESCE(available_inventory.available_count, 0) = 0
        AND product.product_status = 'published'::public.product_status
      THEN 'unavailable'::public.product_status
      ELSE product.product_status
    END,
    updated_at = now()
FROM (SELECT product.id FROM public.products product) existing_products
LEFT JOIN available_inventory ON available_inventory.product_id = existing_products.id
WHERE product.id = existing_products.id
  AND (
    product.stock IS DISTINCT FROM COALESCE(available_inventory.available_count, 0)
    OR product.product_status IS DISTINCT FROM CASE
      WHEN COALESCE(available_inventory.available_count, 0) = 0
        AND product.product_status = 'published'::public.product_status
      THEN 'unavailable'::public.product_status
      ELSE product.product_status
    END
  );

CREATE OR REPLACE FUNCTION public.admin_inventory_summary(_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: administrator access required';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'total', count(*),
      'available', count(*) FILTER (WHERE order_id IS NULL AND assigned_to IS NULL),
      'sold', count(*) FILTER (WHERE assigned_to IS NOT NULL),
      'reserved', count(*) FILTER (WHERE order_id IS NOT NULL AND assigned_to IS NULL),
      'newlyAdded', count(*) FILTER (WHERE created_at >= now() - interval '24 hours')
    )
    FROM public.product_credentials
    WHERE product_id = _product_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_inventory_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_inventory_summary(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_available_inventory(_product_id uuid)
RETURNS TABLE(
  id uuid,
  username text,
  password text,
  specifications jsonb,
  delivery_instructions text,
  content text,
  created_at timestamptz
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
  RETURN QUERY
  SELECT credential.id, credential.username, credential.password,
    credential.specifications, credential.delivery_instructions, credential.content, credential.created_at
  FROM public.product_credentials credential
  WHERE credential.product_id = _product_id
    AND credential.order_id IS NULL AND credential.assigned_to IS NULL
  ORDER BY credential.created_at, credential.id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_available_inventory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_available_inventory(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_available_inventory(
  _credential_id uuid,
  _username text,
  _password text,
  _specifications jsonb,
  _delivery_instructions text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  credential public.product_credentials;
  specification_text text;
  next_content text;
BEGIN
  IF actor IS NULL OR NOT public.is_active_admin(actor) THEN
    RAISE EXCEPTION 'Forbidden: administrator access required';
  END IF;
  IF _specifications IS NULL OR jsonb_typeof(_specifications) <> 'object' THEN
    RAISE EXCEPTION 'Specifications must be a JSON object';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(_specifications)) > 20 THEN
    RAISE EXCEPTION 'A record can have at most 20 specification fields';
  END IF;
  IF length(btrim(COALESCE(_username, ''))) NOT BETWEEN 1 AND 1000
    OR length(btrim(COALESCE(_password, ''))) = 0 OR length(_password) > 5000
    OR length(COALESCE(_delivery_instructions, '')) > 5000 THEN
    RAISE EXCEPTION 'Invalid inventory fields';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(_specifications) AS field(key, value)
    WHERE jsonb_typeof(field.value) <> 'string'
  ) THEN RAISE EXCEPTION 'Specification values must be text'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(_specifications) AS field(key, value)
    WHERE length(field.key) NOT BETWEEN 1 AND 100 OR length(field.value) > 500
  ) THEN RAISE EXCEPTION 'Invalid specification fields'; END IF;

  SELECT * INTO credential FROM public.product_credentials
  WHERE id = _credential_id FOR UPDATE;
  IF NOT FOUND OR credential.order_id IS NOT NULL OR credential.assigned_to IS NOT NULL THEN
    RAISE EXCEPTION 'Only available inventory can be edited';
  END IF;
  SELECT string_agg(field.key || ': ' || field.value, E'\n' ORDER BY field.key)
    INTO specification_text
  FROM jsonb_each_text(_specifications) AS field(key, value);
  next_content := 'ID: ' || btrim(_username) || E'\nPassword: ' || _password;
  IF specification_text IS NOT NULL THEN next_content := next_content || E'\n' || specification_text; END IF;
  IF COALESCE(_delivery_instructions, '') <> '' THEN
    next_content := next_content || E'\nInstructions: ' || _delivery_instructions;
  END IF;
  IF length(next_content) > 10000 THEN RAISE EXCEPTION 'Inventory record exceeds the 10000-character limit'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_credentials other
    WHERE other.product_id = credential.product_id AND other.id <> credential.id
      AND other.content = next_content
  ) THEN RAISE EXCEPTION 'This inventory record duplicates another record'; END IF;

  UPDATE public.product_credentials SET
    content = next_content,
    username = btrim(_username),
    password = _password,
    specifications = _specifications,
    delivery_instructions = COALESCE(_delivery_instructions, '')
  WHERE id = credential.id;
  INSERT INTO public.activity_logs(actor_id, action, target, metadata)
  VALUES (actor, 'admin.product.inventory_updated', credential.product_id::text,
    jsonb_build_object('credential_id', credential.id));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_available_inventory(uuid, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_available_inventory(uuid, text, text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_product_with_inventory(
  _reference uuid,
  _product_id uuid,
  _title text,
  _slug text,
  _category_id uuid,
  _description text,
  _price numeric,
  _status public.product_status,
  _metadata jsonb,
  _inventory jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  current_product public.products;
  saved_product_id uuid;
  safe_metadata jsonb;
  old_image_url text;
  available_count integer;
  saved_count integer := 0;
  entry jsonb;
  entry_username text;
  entry_password text;
  entry_instructions text;
  entry_specifications jsonb;
  entry_content text;
  specification_text text;
  seen_contents text[] := ARRAY[]::text[];
  fingerprint text;
  existing_batch public.admin_inventory_requests;
  previous_values jsonb;
  next_values jsonb;
  row_number integer := 0;
BEGIN
  IF actor IS NULL OR NOT public.is_active_admin(actor) THEN
    RAISE EXCEPTION 'Forbidden: administrator access required';
  END IF;
  IF _reference IS NULL THEN RAISE EXCEPTION 'An idempotency reference is required'; END IF;
  IF length(btrim(COALESCE(_title, ''))) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'Product name must be 1 to 160 characters';
  END IF;
  IF length(btrim(COALESCE(_slug, ''))) NOT BETWEEN 1 AND 180 OR _slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Invalid product slug';
  END IF;
  IF _price IS NULL OR _price <= 0 OR _price > 100000000 OR round(_price, 2) <> _price THEN
    RAISE EXCEPTION 'Invalid product price';
  END IF;
  IF _status IS NULL OR _metadata IS NULL OR jsonb_typeof(_metadata) <> 'object' THEN
    RAISE EXCEPTION 'Invalid product details';
  END IF;
  IF _inventory IS NULL OR jsonb_typeof(_inventory) <> 'array' THEN
    RAISE EXCEPTION 'Inventory must be a JSON array';
  END IF;
  IF jsonb_array_length(_inventory) > 1000 THEN
    RAISE EXCEPTION 'Inventory must contain no more than 1000 entries';
  END IF;
  IF _category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_categories WHERE id = _category_id
  ) THEN RAISE EXCEPTION 'Selected category does not exist'; END IF;

  fingerprint := md5(jsonb_build_object(
    'product_id', _product_id, 'title', _title, 'slug', _slug,
    'category_id', _category_id, 'description', _description, 'price', _price,
    'status', _status, 'metadata', _metadata, 'inventory', _inventory
  )::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(_reference::text, 0));
  SELECT * INTO existing_batch FROM public.admin_inventory_requests
  WHERE reference = _reference;
  IF FOUND THEN
    IF existing_batch.actor_id <> actor OR existing_batch.fingerprint IS DISTINCT FROM fingerprint
      OR (_product_id IS NOT NULL AND existing_batch.product_id <> _product_id) THEN
      RAISE EXCEPTION 'Idempotency reference was already used for another product update';
    END IF;
    SELECT stock INTO available_count FROM public.products WHERE id = existing_batch.product_id;
    RETURN jsonb_build_object(
      'id', existing_batch.product_id,
      'stock', COALESCE(available_count, 0),
      'savedCount', existing_batch.saved_count
    );
  END IF;

  IF _product_id IS NULL THEN
    saved_product_id := gen_random_uuid();
    safe_metadata := _metadata;
    old_image_url := NULL;
    previous_values := NULL;
  ELSE
    SELECT * INTO current_product FROM public.products WHERE id = _product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF current_product.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Restore this archived product before editing it';
    END IF;
    saved_product_id := current_product.id;
    old_image_url := current_product.image_url;
    safe_metadata := (current_product.metadata - 'specifications' - 'delivery_instructions') || _metadata;
    previous_values := jsonb_build_object(
      'title', current_product.title, 'category_id', current_product.category_id,
      'description', current_product.description, 'price', current_product.price,
      'stock', current_product.stock, 'status', current_product.product_status,
      'specifications', current_product.metadata->'specifications'
    );
  END IF;

  FOR entry IN
    SELECT inventory_item.value
    FROM jsonb_array_elements(_inventory) AS inventory_item(value)
  LOOP
    row_number := row_number + 1;
    IF jsonb_typeof(entry) <> 'object' THEN
      RAISE EXCEPTION 'Inventory entry % must be an object', row_number;
    END IF;
    entry_username := entry->>'username';
    entry_password := entry->>'password';
    entry_instructions := COALESCE(entry->>'deliveryInstructions', '');
    entry_specifications := COALESCE(entry->'specifications', '{}'::jsonb);
    IF length(btrim(COALESCE(entry_username, ''))) NOT BETWEEN 1 AND 1000
      OR length(btrim(COALESCE(entry_password, ''))) = 0 OR length(entry_password) > 5000 THEN
      RAISE EXCEPTION 'Inventory entry % requires an ID/username and password', row_number;
    END IF;
    IF jsonb_typeof(entry_specifications) <> 'object' THEN
      RAISE EXCEPTION 'Inventory entry % specifications must be a JSON object', row_number;
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(entry_specifications)) > 20 THEN
      RAISE EXCEPTION 'Inventory entry % has more than 20 specification fields', row_number;
    END IF;
    IF length(entry_instructions) > 5000 THEN
      RAISE EXCEPTION 'Inventory entry % has invalid specifications or instructions', row_number;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_each(entry_specifications) AS field(key, value)
      WHERE jsonb_typeof(field.value) <> 'string'
    ) THEN RAISE EXCEPTION 'Inventory entry % specifications must be text values', row_number; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_each_text(entry_specifications) AS field(key, value)
      WHERE length(field.key) NOT BETWEEN 1 AND 100 OR length(field.value) > 500
    ) THEN RAISE EXCEPTION 'Inventory entry % has invalid specification fields', row_number; END IF;

    SELECT string_agg(field.key || ': ' || field.value, E'\n' ORDER BY field.key)
      INTO specification_text
    FROM jsonb_each_text(entry_specifications) AS field(key, value);
    entry_content := 'ID: ' || btrim(entry_username) || E'\nPassword: ' || entry_password;
    IF specification_text IS NOT NULL THEN entry_content := entry_content || E'\n' || specification_text; END IF;
    IF entry_instructions <> '' THEN entry_content := entry_content || E'\nInstructions: ' || entry_instructions; END IF;
    IF length(entry_content) > 10000 THEN
      RAISE EXCEPTION 'Inventory entry % exceeds the 10000-character limit', row_number;
    END IF;
    IF entry_content = ANY(seen_contents) OR EXISTS (
      SELECT 1 FROM public.product_credentials credential
      WHERE credential.product_id = saved_product_id AND credential.content = entry_content
    ) THEN RAISE EXCEPTION 'Inventory entry % duplicates an existing record', row_number; END IF;
    seen_contents := array_append(seen_contents, entry_content);
  END LOOP;

  INSERT INTO public.products(
    id, title, slug, category_id, description, price, stock, image_url, currency,
    published, product_status, metadata, archived_at, updated_at
  )
  VALUES (
    saved_product_id, btrim(_title), _slug, _category_id,
    NULLIF(btrim(COALESCE(_description, '')), ''), _price, 0, old_image_url, 'NGN',
    _status <> 'draft', _status, safe_metadata, NULL, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, slug = EXCLUDED.slug, category_id = EXCLUDED.category_id,
    description = EXCLUDED.description, price = EXCLUDED.price, image_url = EXCLUDED.image_url,
    published = EXCLUDED.published, product_status = EXCLUDED.product_status,
    metadata = EXCLUDED.metadata, updated_at = now();

  FOR entry IN
    SELECT inventory_item.value
    FROM jsonb_array_elements(_inventory) AS inventory_item(value)
  LOOP
    entry_username := btrim(entry->>'username');
    entry_password := entry->>'password';
    entry_instructions := COALESCE(entry->>'deliveryInstructions', '');
    entry_specifications := COALESCE(entry->'specifications', '{}'::jsonb);
    SELECT string_agg(field.key || ': ' || field.value, E'\n' ORDER BY field.key)
      INTO specification_text
    FROM jsonb_each_text(entry_specifications) AS field(key, value);
    entry_content := 'ID: ' || entry_username || E'\nPassword: ' || entry_password;
    IF specification_text IS NOT NULL THEN entry_content := entry_content || E'\n' || specification_text; END IF;
    IF entry_instructions <> '' THEN entry_content := entry_content || E'\nInstructions: ' || entry_instructions; END IF;
    INSERT INTO public.product_credentials(
      product_id, content, username, password, specifications, delivery_instructions
    ) VALUES (
      saved_product_id, entry_content, entry_username, entry_password, entry_specifications, entry_instructions
    );
    saved_count := saved_count + 1;
  END LOOP;

  SELECT count(*) INTO available_count FROM public.product_credentials
  WHERE product_credentials.product_id = saved_product_id
    AND order_id IS NULL AND assigned_to IS NULL;
  IF _status = 'published' AND available_count = 0 THEN
    RAISE EXCEPTION 'A published product needs available delivery inventory';
  END IF;
  UPDATE public.products SET stock = available_count, updated_at = now()
  WHERE id = saved_product_id;

  next_values := jsonb_build_object(
    'title', btrim(_title), 'category_id', _category_id,
    'description', NULLIF(btrim(COALESCE(_description, '')), ''), 'price', _price,
    'stock', available_count, 'status', _status,
    'specifications', safe_metadata->'specifications', 'inventory_added', saved_count
  );
  INSERT INTO public.activity_logs(actor_id, action, target, metadata)
  VALUES (
    actor,
    CASE WHEN _product_id IS NULL THEN 'admin.product.created'
      WHEN current_product.category_id IS DISTINCT FROM _category_id THEN 'admin.product.category_changed'
      WHEN current_product.price IS DISTINCT FROM _price THEN 'admin.product.price_changed'
      WHEN current_product.product_status IS DISTINCT FROM _status THEN 'admin.product.status_changed'
      ELSE 'admin.product.updated' END,
    saved_product_id::text,
    jsonb_build_object('before', previous_values, 'after', next_values)
  );
  INSERT INTO public.admin_inventory_requests(reference, product_id, actor_id, credential_id, fingerprint, saved_count)
  VALUES (
    _reference,
    saved_product_id,
    actor,
    (SELECT id FROM public.product_credentials WHERE product_id = saved_product_id AND order_id IS NULL AND assigned_to IS NULL ORDER BY created_at DESC LIMIT 1),
    fingerprint,
    saved_count
  );

  RETURN jsonb_build_object('id', saved_product_id, 'stock', available_count, 'savedCount', saved_count);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_save_product_with_inventory(uuid, uuid, text, text, uuid, text, numeric, public.product_status, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_product_with_inventory(uuid, uuid, text, text, uuid, text, numeric, public.product_status, jsonb, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_save_product(uuid, text, text, uuid, text, numeric, integer, text, public.product_status, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_add_product_credential(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

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
  SELECT * INTO p FROM public.products
  WHERE id = _product_id AND published AND product_status = 'published' AND archived_at IS NULL
    AND (category_id IS NULL OR EXISTS (
      SELECT 1 FROM public.product_categories c
      WHERE c.id = products.category_id AND c.is_active AND c.deleted_at IS NULL
    ))
  FOR UPDATE;
  IF NOT FOUND OR p.stock < _quantity THEN RAISE EXCEPTION 'Product is unavailable'; END IF;
  SELECT * INTO w FROM public.wallets WHERE user_id = u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF w.currency <> p.currency THEN RAISE EXCEPTION 'Currency mismatch'; END IF;
  total := p.price * _quantity;
  IF w.balance < total THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;
  SELECT array_agg(c.id) INTO ids FROM (
    SELECT id FROM public.product_credentials
    WHERE product_id = _product_id AND order_id IS NULL AND assigned_to IS NULL
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT _quantity
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
  UPDATE public.product_credentials SET order_id = ord, assigned_to = u, delivered_at = now()
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
    SELECT p.id, p.title, p.price, p.stock, p.published, p.product_status, p.archived_at,
      p.currency, p.category_id, c.quantity
    FROM public.cart_items c JOIN public.products p ON p.id = c.product_id
    WHERE c.user_id = _user ORDER BY p.id FOR UPDATE OF p, c
  LOOP
    IF NOT r.published OR r.product_status <> 'published' OR r.archived_at IS NOT NULL
      OR r.currency <> 'NGN' OR r.stock < r.quantity OR r.quantity NOT BETWEEN 1 AND 20
      OR (r.category_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.product_categories category
        WHERE category.id = r.category_id AND category.is_active AND category.deleted_at IS NULL
      )) THEN RAISE EXCEPTION 'An item is unavailable or exceeds stock'; END IF;
    total := total + r.price * r.quantity;
  END LOOP;
  IF total <= 0 THEN RAISE EXCEPTION 'Invalid order total'; END IF;
  IF NOT _external AND w.balance < total THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;
  ref := 'bp-' || _request::text;
  INSERT INTO public.orders(user_id, total, currency, status, request_key, payment_reference)
  VALUES (_user, total, 'NGN', 'pending', _request, ref) RETURNING id INTO ord;

  FOR r IN
    SELECT p.*, c.quantity FROM public.cart_items c
    JOIN public.products p ON p.id = c.product_id
    WHERE c.user_id = _user ORDER BY p.id
  LOOP
    SELECT array_agg(t.id) INTO ids FROM (
      SELECT id FROM public.product_credentials
      WHERE product_id = r.id AND order_id IS NULL AND assigned_to IS NULL
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT r.quantity
    ) t;
    IF COALESCE(cardinality(ids), 0) < r.quantity THEN
      RAISE EXCEPTION 'An item has insufficient deliverable inventory';
    END IF;
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
    VALUES (w.id, _user, 'debit', total, w.balance, 'manual', ref, 'Cart purchase') RETURNING id INTO tx;
    UPDATE public.orders SET status = 'completed', wallet_tx_id = tx WHERE id = ord;
    UPDATE public.product_credentials SET assigned_to = _user, delivered_at = now() WHERE order_id = ord;
    UPDATE public.order_items i SET delivered_payload = (
      SELECT string_agg(c.content, E'\n---\n' ORDER BY c.created_at)
      FROM public.product_credentials c WHERE c.order_id = ord AND c.product_id = i.product_id
    ) WHERE i.order_id = ord;
    DELETE FROM public.cart_items WHERE user_id = _user
      AND product_id IN (SELECT product_id FROM public.order_items WHERE order_id = ord);
  END IF;
  RETURN ord;
END;
$$;

NOTIFY pgrst, 'reload schema';
