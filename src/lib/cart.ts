import { supabase } from "@/integrations/supabase/client";

export async function addCartItem(userId: string, productId: string) {
  const { data: existing, error: lookupError } = await supabase
    .from("cart_items")
    .select("quantity")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();
  if (lookupError) throw new Error("The cart could not be updated. Please try again.");
  if (existing?.quantity === 20) throw new Error("The maximum quantity for this item is 20.");

  const quantity = (existing?.quantity ?? 0) + 1;
  const result = existing
    ? await supabase
        .from("cart_items")
        .update({ quantity, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("product_id", productId)
    : await supabase
        .from("cart_items")
        .insert({ user_id: userId, product_id: productId, quantity });

  if (!result.error) return;
  if (!existing && result.error.code === "23505") {
    const { data: concurrent, error: retryLookupError } = await supabase
      .from("cart_items")
      .select("quantity")
      .eq("user_id", userId)
      .eq("product_id", productId)
      .maybeSingle();
    if (retryLookupError || !concurrent || concurrent.quantity === 20) {
      throw new Error("The cart could not be updated. Please try again.");
    }
    const { error: retryError } = await supabase
      .from("cart_items")
      .update({ quantity: concurrent.quantity + 1, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("product_id", productId);
    if (!retryError) return;
  }
  throw new Error("The cart could not be updated. Please try again.");
}
