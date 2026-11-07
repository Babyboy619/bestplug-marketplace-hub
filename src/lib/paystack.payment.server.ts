import {
  getPaystackConfig,
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from "@/lib/paystack.server";
import { paymentReferenceSchema, topupAmountSchema } from "@/lib/payment-validation";

function errorField(error: unknown, field: "code" | "message" | "details" | "hint") {
  if (typeof error !== "object" || error === null || !(field in error)) return null;
  const value = (error as Record<string, unknown>)[field];
  if (typeof value !== "string") return null;
  return value
    .slice(0, 2000)
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9]+\b/g, "[REDACTED]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}

function logDatabaseFailure(operationStage: string, reference: string, error: unknown) {
  console.error("[wallet-payments] database operation failed", {
    operationStage,
    reference,
    code: errorField(error, "code"),
    message: errorField(error, "message"),
    details: errorField(error, "details"),
    hint: errorField(error, "hint"),
  });
}

function toMinorUnits(amount: number) {
  return Math.round(amount * 100);
}

export async function initializeWalletTopup(input: {
  userId: string;
  email: string;
  amount: number;
  callbackUrl: string;
}) {
  const amount = topupAmountSchema.parse({ amount: input.amount }).amount;
  const email = input.email.trim();
  if (!email) throw new Error("Your account needs a verified email to start payment.");
  const config = getPaystackConfig();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const reference = `ps-${crypto.randomUUID()}`;
  try {
    const { error: intentError } = await supabaseAdmin.from("payment_intents").insert({
      user_id: input.userId,
      provider: "paystack",
      reference,
      amount,
      currency: "NGN",
      status: "pending",
    });
    if (intentError) throw intentError;
  } catch (error) {
    logDatabaseFailure("intent_insert", reference, error);
    throw new Error("Your payment could not be recorded. Please try again.");
  }

  try {
    const checkout = await initializePaystackTransaction(config, {
      email,
      amountMinor: toMinorUnits(amount),
      reference,
      callbackUrl: input.callbackUrl,
    });
    const { data: savedIntent, error: saveError } = await supabaseAdmin
      .from("payment_intents")
      .update({
        provider_reference: checkout.accessCode,
        raw: {
          provider_reference: checkout.accessCode,
          authorization_url: checkout.authorizationUrl,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("reference", reference)
      .eq("user_id", input.userId)
      .eq("status", "pending")
      .select("reference")
      .maybeSingle();
    if (saveError || !savedIntent) {
      logDatabaseFailure("checkout_details_update", reference, saveError);
      throw new Error("The payment checkout could not be saved. Please try again.");
    }
    return { reference, authorizationUrl: checkout.authorizationUrl, amount };
  } catch (error) {
    const { data: failedIntent, error: failureUpdateError } = await supabaseAdmin
      .from("payment_intents")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("reference", reference)
      .eq("user_id", input.userId)
      .eq("status", "pending")
      .select("reference")
      .maybeSingle();
    if (failureUpdateError || !failedIntent) {
      logDatabaseFailure("failed_intent_update", reference, failureUpdateError);
    }
    throw error instanceof Error
      ? error
      : new Error("Paystack could not start this payment. Please try again.");
  }
}

export async function verifyWalletTopup(reference: string, userId: string) {
  reference = paymentReferenceSchema.parse(reference);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: intent, error: intentError } = await supabaseAdmin
    .from("payment_intents")
    .select("reference,amount,status,currency")
    .eq("reference", reference)
    .eq("user_id", userId)
    .eq("provider", "paystack")
    .maybeSingle();
  if (intentError || !intent) throw new Error("This payment reference could not be found.");
  if (intent.status === "success") {
    return { status: "success", amount: Number(intent.amount), alreadyCredited: true };
  }
  if (intent.status !== "pending") return { status: intent.status, amount: Number(intent.amount) };

  const checked = await verifyPaystackTransaction(
    getPaystackConfig(),
    intent.reference,
    toMinorUnits(Number(intent.amount)),
  );
  if (!checked.confirmed) {
    if (checked.pending) {
      return {
        status: "pending",
        amount: Number(intent.amount),
        error: "Payment is still pending confirmation.",
      };
    }

    const mismatchError =
      checked.amountMinor !== null && checked.amountMinor !== toMinorUnits(Number(intent.amount))
        ? "Payment amount did not match."
        : checked.currency !== null && checked.currency !== "NGN"
          ? "Payment currency did not match."
          : "Payment was not confirmed.";
    const { error } = await supabaseAdmin.rpc("fail_paystack", { _reference: intent.reference });
    if (error) throw new Error("Payment status could not be updated. Please check again.");
    const { data: latestIntent, error: latestError } = await supabaseAdmin
      .from("payment_intents")
      .select("status")
      .eq("reference", intent.reference)
      .eq("user_id", userId)
      .eq("provider", "paystack")
      .maybeSingle();
    if (latestError || !latestIntent) {
      throw new Error("Payment status could not be updated. Please check again.");
    }
    if (latestIntent.status === "success") {
      return { status: "success", amount: Number(intent.amount), alreadyCredited: true };
    }
    if (latestIntent.status !== "failed") {
      return { status: latestIntent.status, amount: Number(intent.amount) };
    }
    return { status: "failed", amount: Number(intent.amount), error: mismatchError };
  }

  if (!checked.providerReference) {
    throw new Error("Paystack verification did not return a transaction ID.");
  }
  const { error } = await supabaseAdmin.rpc("settle_paystack", {
    _reference: intent.reference,
    _amount: Number(intent.amount),
    _currency: intent.currency,
    _provider_id: checked.providerReference,
  });
  if (error) throw new Error("Payment was confirmed but wallet settlement needs another check.");
  return { status: "success", amount: Number(intent.amount), alreadyCredited: false };
}
