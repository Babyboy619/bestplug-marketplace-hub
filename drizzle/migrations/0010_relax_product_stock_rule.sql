CREATE OR REPLACE FUNCTION public.admin_save_product(_product_id uuid, _title text, _slug text, _category_id uuid, _description text, _price numeric, _stock integer, _image_url text, _status product_status, _metadata jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  current_product public.products;
  product_id uuid;
  previous_values jsonb;
  next_values jsonb;
  safe_metadata jsonb;
  old_image_url text;
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
  IF _image_url IS NOT NULL AND btrim(_image_url) = '' THEN _image_url := NULL; END IF;
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
    jsonb_build_object('before', previous_values, 'after', next_values)
  );
  RETURN product_id;
END;
$function$;