ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS delivered_specifications jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS delivery_instructions text NOT NULL DEFAULT '';

UPDATE public.order_items item
SET platform = COALESCE(category.name, 'Uncategorized')
FROM public.products product
LEFT JOIN public.product_categories category ON category.id = product.category_id
WHERE item.product_id = product.id AND item.platform IS NULL;

CREATE OR REPLACE FUNCTION public.purchase_product_with_wallet(_product_id uuid, _request uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  product public.products;
  wallet public.wallets;
  credential public.product_credentials;
  existing_order public.orders;
  existing_item public.order_items;
  purchase_order_id uuid;
  order_item_id uuid;
  transaction_id uuid;
  platform_name text;
  available_count integer;
  new_balance numeric;
  wallet_reference text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.is_account_active(actor) THEN RAISE EXCEPTION 'Account suspended or deactivated'; END IF;
  IF _request IS NULL THEN RAISE EXCEPTION 'A checkout request key is required'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || ':' || _request::text, 0));
  SELECT * INTO existing_order
  FROM public.orders
  WHERE user_id = actor AND request_key = _request;
  IF FOUND THEN
    IF existing_order.status <> 'completed' THEN
      RAISE EXCEPTION 'This checkout request is already associated with an incomplete order';
    END IF;
    SELECT * INTO existing_item FROM public.order_items
    WHERE order_id = existing_order.id AND product_id = _product_id
    ORDER BY created_at LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'This checkout request was already used'; END IF;
    IF NULLIF(btrim(existing_item.delivered_payload), '') IS NULL THEN
      RAISE EXCEPTION 'Delivery details are missing for this completed order';
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'orderId', existing_order.id,
      'orderReference', existing_order.id::text,
      'orderItemId', existing_item.id,
      'title', existing_item.title,
      'platform', COALESCE(existing_item.platform, 'Uncategorized'),
      'unitPrice', existing_item.unit_price,
      'createdAt', existing_order.created_at,
      'paymentStatus', existing_order.status,
      'deliveryStatus', CASE WHEN existing_item.delivered_payload IS NULL THEN 'pending' ELSE 'delivered' END,
      'deliveredPayload', existing_item.delivered_payload,
      'specifications', existing_item.delivered_specifications,
      'deliveryInstructions', existing_item.delivery_instructions,
      'availableStock', (SELECT stock FROM public.products WHERE id = _product_id)
    );
  END IF;

  SELECT * INTO product
  FROM public.products
  WHERE id = _product_id
    AND published
    AND product_status = 'published'
    AND archived_at IS NULL
    AND (
      category_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.product_categories category
        WHERE category.id = products.category_id
          AND category.is_active AND category.deleted_at IS NULL
      )
    )
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This product is unpublished or unavailable'; END IF;

  SELECT count(*) INTO available_count
  FROM public.product_credentials
  WHERE product_id = _product_id AND order_id IS NULL AND assigned_to IS NULL;
  IF available_count = 0 THEN
    UPDATE public.products
    SET stock = 0, product_status = 'unavailable', updated_at = now()
    WHERE id = _product_id;
    RETURN jsonb_build_object('ok', false, 'code', 'out_of_stock');
  END IF;

  PERFORM public.ensure_user_wallet();
  SELECT * INTO wallet FROM public.wallets WHERE user_id = actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  IF wallet.currency <> product.currency THEN RAISE EXCEPTION 'Currency mismatch'; END IF;
  IF wallet.balance < product.price THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;

  SELECT * INTO credential
  FROM public.product_credentials
  WHERE product_id = _product_id AND order_id IS NULL AND assigned_to IS NULL
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This product just sold out'; END IF;
  IF NULLIF(btrim(credential.content), '') IS NULL
    OR jsonb_typeof(credential.specifications) <> 'object' THEN
    RAISE EXCEPTION 'Delivery details are missing or invalid';
  END IF;

  SELECT COALESCE(category.name, 'Uncategorized') INTO platform_name
  FROM public.products current_product
  LEFT JOIN public.product_categories category ON category.id = current_product.category_id
  WHERE current_product.id = _product_id;

  UPDATE public.wallets
  SET balance = balance - product.price, updated_at = now()
  WHERE id = wallet.id
  RETURNING balance INTO new_balance;
  wallet_reference := 'buy-now-' || _request::text;
  INSERT INTO public.wallet_transactions(
    wallet_id, user_id, type, amount, balance_after, status, provider, reference, description,
    metadata
  ) VALUES (
    wallet.id, actor, 'debit', product.price, new_balance, 'success', 'manual',
    wallet_reference, 'Purchase: ' || product.title,
    jsonb_build_object('product_id', product.id, 'request_key', _request)
  )
  RETURNING id INTO transaction_id;

  INSERT INTO public.orders(user_id, total, currency, status, wallet_tx_id, request_key)
  VALUES (actor, product.price, product.currency, 'completed', transaction_id, _request)
  RETURNING id INTO purchase_order_id;

  UPDATE public.product_credentials
  SET order_id = purchase_order_id, assigned_to = actor, delivered_at = now()
  WHERE id = credential.id AND order_id IS NULL AND assigned_to IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory assignment failed'; END IF;

  INSERT INTO public.order_items(
    order_id, product_id, title, unit_price, quantity, delivered_payload, platform,
    delivered_specifications, delivery_instructions
  ) VALUES (
    purchase_order_id, product.id, product.title, product.price, 1, credential.content,
    platform_name, COALESCE(credential.specifications, '{}'::jsonb),
    COALESCE(credential.delivery_instructions, '')
  ) RETURNING id INTO order_item_id;

  SELECT count(*) INTO available_count
  FROM public.product_credentials
  WHERE product_id = _product_id AND order_id IS NULL AND assigned_to IS NULL;
  UPDATE public.products
  SET stock = available_count,
      product_status = CASE
        WHEN available_count = 0 THEN 'unavailable'::public.product_status
        ELSE product_status
      END,
      updated_at = now()
  WHERE id = _product_id;

  RETURN jsonb_build_object(
    'ok', true,
    'orderId', purchase_order_id,
    'orderReference', purchase_order_id::text,
    'orderItemId', order_item_id,
    'title', product.title,
    'platform', platform_name,
    'unitPrice', product.price,
    'createdAt', now(),
    'paymentStatus', 'completed',
    'deliveryStatus', 'delivered',
    'deliveredPayload', credential.content,
    'specifications', COALESCE(credential.specifications, '{}'::jsonb),
    'deliveryInstructions', COALESCE(credential.delivery_instructions, ''),
    'availableStock', available_count
  );
END;
$$;
REVOKE ALL ON FUNCTION public.purchase_product_with_wallet(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_product_with_wallet(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.purchase_with_wallet(uuid, integer) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
