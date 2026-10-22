import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveAccount } from "@/lib/active-account.middleware";
import type { ProductPurchaseResult } from "@/lib/purchase.types";

export const purchaseProduct = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) =>
    z.object({ productId: z.string().uuid(), request: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("purchase_product_with_wallet", {
      _product_id: data.productId,
      _request: data.request,
    });
    if (error) {
      console.error("Wallet product purchase failed:", error);
      throw new Error(error.message);
    }
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error(
        "The purchase response was invalid. Please check your orders before retrying.",
      );
    }
    const payload = result as unknown as ProductPurchaseResult | { ok: false; code: string };
    if (!payload.ok) {
      if (payload.code === "out_of_stock") {
        throw new Error("This product is out of stock.");
      }
      throw new Error("This product could not be purchased.");
    }
    return payload;
  });
