CREATE OR REPLACE FUNCTION public.admin_save_product_with_logs(
  _reference uuid,
  _product_id uuid,
  _title text,
  _slug text,
  _category_id uuid,
  _description text,
  _price numeric,
  _status public.product_status,
  _metadata jsonb,
  _logs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  saved_product_id uuid;
  product_save_result jsonb;
  available_count integer;
  saved_count integer := 0;
  first_credential_id uuid;
  log_entry jsonb;
  log_content text;
  fingerprint text;
  existing_request public.admin_inventory_requests;
BEGIN
  IF actor IS NULL OR NOT public.is_active_admin(actor) THEN
    RAISE EXCEPTION 'Forbidden: administrator access required';
  END IF;
  IF _reference IS NULL THEN RAISE EXCEPTION 'An idempotency reference is required'; END IF;
  IF _logs IS NULL OR jsonb_typeof(_logs) <> 'array' THEN
    RAISE EXCEPTION 'Logs must be a JSON array';
  END IF;
  IF jsonb_array_length(_logs) > 1000 THEN
    RAISE EXCEPTION 'A product can receive at most 1000 log lines per save';
  END IF;

  FOR log_entry IN
    SELECT line.value FROM jsonb_array_elements(_logs) AS line(value)
  LOOP
    IF jsonb_typeof(log_entry) <> 'string' THEN RAISE EXCEPTION 'Each log must be text'; END IF;
    log_content := btrim(log_entry #>> '{}');
    IF log_content = '' THEN RAISE EXCEPTION 'Blank log lines must be omitted'; END IF;
    IF length(log_content) > 10000 THEN RAISE EXCEPTION 'Each log line must be 10000 characters or fewer'; END IF;
  END LOOP;

  fingerprint := md5(jsonb_build_object(
    'product_id', _product_id,
    'title', _title,
    'slug', _slug,
    'category_id', _category_id,
    'description', _description,
    'price', _price,
    'status', _status,
    'metadata', _metadata,
    'logs', _logs
  )::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || ':' || _reference::text, 0));
  SELECT * INTO existing_request
  FROM public.admin_inventory_requests
  WHERE reference = _reference;
  IF FOUND THEN
    IF existing_request.actor_id <> actor
      OR existing_request.fingerprint IS DISTINCT FROM fingerprint
      OR (_product_id IS NOT NULL AND existing_request.product_id <> _product_id) THEN
      RAISE EXCEPTION 'Idempotency reference was already used for another product update';
    END IF;
    SELECT count(*) INTO available_count FROM public.product_credentials
    WHERE product_id = existing_request.product_id
      AND order_id IS NULL AND assigned_to IS NULL;
    RETURN jsonb_build_object(
      'id', existing_request.product_id,
      'stock', available_count,
      'savedCount', existing_request.saved_count
    );
  END IF;

  product_save_result := public.admin_save_product_with_inventory(
    _reference,
    _product_id,
    _title,
    _slug,
    _category_id,
    _description,
    _price,
    'draft'::public.product_status,
    _metadata,
    '[]'::jsonb
  );
  saved_product_id := (product_save_result->>'id')::uuid;
  DELETE FROM public.admin_inventory_requests WHERE reference = _reference;

  FOR log_entry IN
    SELECT line.value FROM jsonb_array_elements(_logs) AS line(value)
  LOOP
    log_content := btrim(log_entry #>> '{}');
    INSERT INTO public.product_credentials(
      product_id, content, specifications, delivery_instructions
    ) VALUES (
      saved_product_id, log_content, '{}'::jsonb, ''
    )
    RETURNING id INTO first_credential_id;
    saved_count := saved_count + 1;
  END LOOP;

  SELECT count(*)::integer INTO available_count
  FROM public.product_credentials
  WHERE product_id = saved_product_id
    AND order_id IS NULL AND assigned_to IS NULL;
  IF _status = 'published' AND available_count = 0 THEN
    RAISE EXCEPTION 'A published product needs available delivery inventory';
  END IF;

  UPDATE public.products
  SET stock = available_count,
      product_status = _status,
      published = (_status <> 'draft'),
      updated_at = now()
  WHERE id = saved_product_id;
  INSERT INTO public.activity_logs(actor_id, action, target, metadata)
  VALUES (
    actor,
    CASE WHEN saved_count > 0 THEN 'admin.product.inventory_added' ELSE 'admin.product.updated' END,
    saved_product_id::text,
    jsonb_build_object('inventory_count', saved_count, 'available_stock', available_count, 'status', _status)
  );

  INSERT INTO public.admin_inventory_requests(
    reference, product_id, actor_id, credential_id, fingerprint, saved_count
  ) VALUES (
    _reference, saved_product_id, actor, first_credential_id, fingerprint, saved_count
  );
  INSERT INTO public.activity_logs(actor_id, action, target, metadata)
  VALUES (
    actor,
    CASE WHEN saved_count = 0 THEN 'admin.product.updated' ELSE 'admin.product.inventory_added' END,
    saved_product_id::text,
    jsonb_build_object('inventory_count', saved_count, 'available_stock', available_count)
  );

  RETURN jsonb_build_object(
    'id', saved_product_id,
    'stock', available_count,
    'savedCount', saved_count
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_save_product_with_logs(uuid, uuid, text, text, uuid, text, numeric, public.product_status, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_product_with_logs(uuid, uuid, text, text, uuid, text, numeric, public.product_status, jsonb, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_save_product_with_inventory(uuid, uuid, text, text, uuid, text, numeric, public.product_status, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_product_delivery_instructions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.product_id IS NOT NULL AND COALESCE(NEW.delivery_instructions, '') = '' THEN
    SELECT COALESCE(NULLIF(btrim(product.metadata->>'delivery_instructions'), ''), '')
      INTO NEW.delivery_instructions
    FROM public.products product
    WHERE product.id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_product_delivery_instructions() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS order_items_apply_product_delivery_instructions ON public.order_items;
CREATE TRIGGER order_items_apply_product_delivery_instructions
BEFORE INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.apply_product_delivery_instructions();

NOTIFY pgrst, 'reload schema';
