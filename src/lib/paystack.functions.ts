import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActiveAccount } from "@/lib/active-account.middleware";
import { z } from "zod";
import { paymentAmount } from "./paystack-validation";
import {
  getPaystackConfig,
  initializePaystackTransaction,
  settleVerified,
} from "./paystack.server";

export const initializePayment = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((v) =>
    z
      .object({ amount: paymentAmount.optional(), cart: z.boolean(), request: z.string().uuid() })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const request = getRequest();
    const config = getPaystackConfig(request);
    await context.supabase.rpc("ensure_user_wallet");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const reference = `bp-${data.request}`;
    const { data: existing } = await context.supabase
      .from("payment_intents")
      .select("raw,status")
      .eq("reference", reference)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existing) {
      const raw = existing.raw as Record<string, unknown>;
      if (typeof raw["authorization_url"] === "string" && existing.status === "pending")
        return { url: raw["authorization_url"], reference };
      throw new Error(
        "This checkout is already processing. Check its payment status before trying again.",
      );
    }
    let orderId: string | null = null;
    let amount = data.amount;
    if (data.cart) {
      const result = await supabaseAdmin.rpc("prepare_cart_order", {
        _user: context.userId,
        _request: data.request,
        _external: true,
      });
      if (result.error) throw new Error(result.error.message);
      orderId = result.data;
      const { data: order } = await context.supabase
        .from("orders")
        .select("total")
        .eq("id", orderId)
        .single();
      amount = Number(order?.total);
    }
    if (!amount || amount <= 0) throw new Error("Invalid payment amount");
    const intent = await supabaseAdmin.from("payment_intents").insert({
      user_id: context.userId,
      provider: "paystack",
      reference,
      amount,
      currency: "NGN",
      order_id: orderId,
    });
    if (intent.error) throw new Error("This payment is already processing. Check payment status.");
    try {
      const origin = new URL(request.url).origin;
      const checkout = await initializePaystackTransaction(config, {
        email: String(context.claims.email ?? ""),
        amountMinor: Math.round(amount * 100),
        reference,
        callbackUrl: `${origin}/payment-return`,
      });
      const { error: saveError } = await supabaseAdmin
        .from("payment_intents")
        .update({
          provider_reference: checkout.accessCode,
          raw: { authorization_url: checkout.authorizationUrl },
          updated_at: new Date().toISOString(),
        })
        .eq("reference", reference);
      if (saveError) throw new Error("The payment checkout could not be saved. Please try again.");
      return { url: checkout.authorizationUrl, reference };
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `${error.message} Your payment remains pending until verified.`
          : "Payment initialization is pending.",
      );
    }
  });
export const verifyPayment = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((v) => z.object({ reference: z.string().regex(/^bp-[a-f0-9-]{36}$/) }).parse(v))
  .handler(async ({ data, context }) => {
    const request = getRequest();
    const { data: intent } = await context.supabase
      .from("payment_intents")
      .select("id")
      .eq("reference", data.reference)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!intent) throw new Error("Payment not found for your account");
    return settleVerified(data.reference, getPaystackConfig(request));
  });
