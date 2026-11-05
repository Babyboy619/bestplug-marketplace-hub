import { createServerFn } from "@tanstack/react-start";
import { topupAmountSchema } from "@/lib/payment-validation";
import { requireActiveAccount } from "@/lib/active-account.middleware";
import { initializeWalletTopup, verifyWalletTopup } from "@/lib/paystark.payment.server";
import { z } from "zod";

const referenceSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(8)
    .max(80)
    .regex(/^[A-Za-z0-9._-]+$/),
});

export const startPaystarkTopup = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .validator((input) => topupAmountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const emailClaim = context.claims.email;
    const email = typeof emailClaim === "string" ? emailClaim : "";
    if (!email) throw new Error("Your account needs a verified email to start payment.");

    const { getRequest } = await import("@tanstack/react-start/server");
    const origin = new URL(getRequest().url).origin;
    return initializeWalletTopup({
      userId: context.userId,
      email,
      amount: data.amount,
      callbackUrl: new URL("/payments/callback", origin).toString(),
    });
  });

export const verifyPaystarkTopup = createServerFn({ method: "POST" })
  .middleware([requireActiveAccount])
  .validator((input) => referenceSchema.parse(input))
  .handler(async ({ data, context }) => {
    return verifyWalletTopup(data.reference, context.userId);
  });
