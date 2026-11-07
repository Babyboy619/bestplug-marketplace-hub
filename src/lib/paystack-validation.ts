import { z } from "zod";
export const paymentAmount = z.coerce
  .number()
  .finite()
  .min(100)
  .max(1_000_000)
  .refine(
    (n) =>
      Number.isInteger(Math.round(n * 100)) && Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
    "Use at most two decimal places",
  );
export const nameSchema = z.string().trim().min(2).max(80);
export const passwordSchema = z
  .object({ current: z.string().min(1), password: z.string().min(8).max(128), confirm: z.string() })
  .refine((v) => v.password === v.confirm, "Passwords do not match");
export const quantitySchema = z.number().int().min(1).max(20);
