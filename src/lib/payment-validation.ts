import { z } from "zod";
export const TOPUP_MIN_AMOUNT = 100;
export const TOPUP_MAX_AMOUNT = 1_000_000;
export const topupAmountSchema = z.object({
  amount: z.coerce
    .number()
    .finite()
    .min(TOPUP_MIN_AMOUNT, "Minimum top-up is ₦100.")
    .max(TOPUP_MAX_AMOUNT, "Maximum top-up is ₦1,000,000.")
    .refine(
      (amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 0.00001,
      "Use at most two decimal places.",
    ),
});
export const paymentReferenceSchema = z
  .string()
  .trim()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/);
