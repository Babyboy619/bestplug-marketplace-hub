import { z } from 'zod';
export const TOPUP_MIN_AMOUNT=100;
export const TOPUP_MAX_AMOUNT=1_000_000;
export const topupAmountSchema=z.object({amount:z.coerce.number().finite().min(TOPUP_MIN_AMOUNT,'Minimum top-up is ₦100.').max(TOPUP_MAX_AMOUNT,'Maximum top-up is ₦1,000,000.')});