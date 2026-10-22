import { createServerFn } from "@tanstack/react-start";
import { requireActiveAccount } from "@/lib/active-account.middleware";
import { topupAmountSchema } from "@/lib/payment-validation";
import { z } from "zod";

const referenceSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(8)
    .max(80)
    .regex(/^[A-Za-z0-9._-]+$/),
});

function getConfig() {
  const secret = process.env["NEURAPAY_SECRET_KEY"];
  const businessId = process.env["NEURAPAY_BUSINESS_ID"];
  const webhookSecret = process.env["NEURAPAY_WEBHOOK_SECRET"] ?? "";
  if (!secret || !businessId) throw new Error("Wallet transfers are temporarily unavailable.");
  return { secret, businessId, webhookSecret, baseUrl: process.env["NEURAPAY_BASE_URL"] };
}

export const startNeuraPayTopup = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => topupAmountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const config = getConfig();
    const { error: walletError } = await context.supabase.rpc("ensure_user_wallet");
    if (walletError) throw new Error("Your wallet could not be prepared. Please try again.");

    const [{ supabaseAdmin }, neurapay] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/neurapay.server"),
    ]);
    const reference = `np-${crypto.randomUUID()}`;
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("display_name,email")
      .eq("id", context.userId)
      .maybeSingle();

    const { error: intentError } = await supabaseAdmin.from("payment_intents").insert({
      user_id: context.userId,
      provider: "neurapay",
      reference,
      amount: data.amount,
      currency: "NGN",
      status: "pending",
    });
    if (intentError) throw new Error("We could not start this transfer. Please try again.");

    const gateway = neurapay.makeNeuraPayConfig(
      config.secret,
      config.businessId,
      config.webhookSecret,
      config.baseUrl,
    );
    const response = await neurapay.neuraPayRequest(gateway, "virtual-accounts", "POST", {
      customer_name: profile?.display_name || profile?.email?.split("@")[0] || "Customer",
      customer_email: profile?.email || String(context.claims.email ?? ""),
      amount: data.amount,
      reference,
      currency: "NGN",
      description: `Wallet funding (${reference})`,
    });

    const accountNumber = neurapay.findNeuraPayField(response.json, [
      "accountNumber",
      "account_number",
      "virtualAccountNumber",
      "virtual_account_number",
      "accountNo",
      "account_no",
    ]);
    const bankName = neurapay.findNeuraPayField(response.json, [
      "bankName",
      "bank_name",
      "bank",
      "accountBank",
    ]);
    const accountName = neurapay.findNeuraPayField(response.json, ["accountName", "account_name"]);
    const paymentUrl = neurapay.safeHttpsUrl(
      neurapay.findNeuraPayField(response.json, [
        "paymentUrl",
        "payment_url",
        "checkoutUrl",
        "checkout_url",
        "authorization_url",
        "link",
        "url",
      ]),
    );
    const explicitFailure =
      response.json?.["success"] === false || response.json?.["status"] === "failed";

    if (!response.ok || explicitFailure || (!accountNumber && !paymentUrl)) {
      await supabaseAdmin
        .from("payment_intents")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("reference", reference)
        .eq("user_id", context.userId);
      console.error("NeuraPay could not create a transfer account", { status: response.status });
      throw new Error(
        "NeuraPay could not create a transfer account just now. Please try again later.",
      );
    }

    const providerReference = neurapay.findNeuraPayField(response.json, [
      "transactionId",
      "transaction_id",
      "transactionReference",
      "transaction_reference",
      "id",
    ]);
    await supabaseAdmin
      .from("payment_intents")
      .update({
        raw: JSON.parse(JSON.stringify(response.json ?? {})),
        provider_reference: providerReference === undefined ? null : String(providerReference),
        updated_at: new Date().toISOString(),
      })
      .eq("reference", reference)
      .eq("user_id", context.userId);

    return {
      reference,
      amount: data.amount,
      accountNumber: accountNumber === undefined ? null : String(accountNumber),
      bankName: bankName === undefined ? null : String(bankName),
      accountName: accountName === undefined ? null : String(accountName),
      paymentUrl,
      instructions: paymentUrl
        ? "Continue using NeuraPay, then return here. Your balance updates after NeuraPay confirms payment."
        : "Transfer the exact amount to this account. Your balance updates after NeuraPay confirms payment.",
    };
  });

export const verifyNeuraPayTopup = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .inputValidator((input) => referenceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: intent, error: intentError } = await context.supabase
      .from("payment_intents")
      .select("id,user_id,reference,provider,provider_reference,amount,status")
      .eq("reference", data.reference)
      .eq("user_id", context.userId)
      .eq("provider", "neurapay")
      .maybeSingle();

    if (intentError || !intent) throw new Error("This transfer reference could not be found.");
    if (intent.status === "success") {
      return {
        success: true,
        status: "successful",
        amount: Number(intent.amount),
        alreadyCredited: true,
      };
    }
    if (intent.status !== "pending")
      return {
        success: false,
        status: intent.status,
        error: "This transfer is no longer pending.",
      };

    const env = getConfig();
    const neurapay = await import("@/lib/neurapay.server");
    const gateway = neurapay.makeNeuraPayConfig(
      env.secret,
      env.businessId,
      env.webhookSecret,
      env.baseUrl,
    );
    const checked = await neurapay.verifyNeuraPayTransaction(
      gateway,
      intent.reference,
      Number(intent.amount),
    );
    if (!checked.confirmed) {
      if (checked.reason === "amount_mismatch" || checked.reason === "currency_mismatch") {
        return {
          success: false,
          status: "failed",
          error: "The amount or currency did not match. Please contact support.",
        };
      }
      return {
        success: false,
        status: checked.status,
        error:
          checked.reason === "unavailable"
            ? "NeuraPay has not confirmed the transfer yet. Please try again shortly."
            : checked.reason === "not_paid"
              ? "This transfer was not completed."
              : "We have not received this transfer yet. Try again after your bank confirms it.",
      };
    }

    const { data: settlement, error: settlementError } = await supabaseAdmin.rpc(
      "settle_neurapay_payment",
      {
        _reference: intent.reference,
        _amount: Number(intent.amount),
        ...(checked.providerReference ? { _provider_reference: checked.providerReference } : {}),
        _provider_data: JSON.parse(JSON.stringify(checked.payload)),
      },
    );
    if (settlementError)
      throw new Error(
        "The transfer was confirmed but the wallet update needs another check. Please retry shortly.",
      );
    const outcome = settlement?.[0];
    return {
      success: true,
      status: "successful",
      amount: Number(intent.amount),
      alreadyCredited: outcome?.already_credited ?? false,
    };
  });
