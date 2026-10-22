import { z } from 'zod';
export const paymentAmount = z.coerce.number().finite().min(100).max(1_000_000).refine(n=>Number.isInteger(Math.round(n*100)) && Math.abs(n*100-Math.round(n*100))<0.00001,'Use at most two decimal places');
export function assertVerifiedPayment(data: {reference?:string;status?:string;amount?:number;currency?:string}, expected:{reference:string;amount:number;currency:string}) {
 if(data.reference!==expected.reference || data.amount!==Math.round(expected.amount*100) || data.currency!==expected.currency) throw new Error('Payment amount, currency or reference mismatch');
 return data.status==='success';
}
export const nameSchema=z.string().trim().min(2).max(80);
export const passwordSchema=z.object({current:z.string().min(1),password:z.string().min(8).max(128),confirm:z.string()}).refine(v=>v.password===v.confirm,'Passwords do not match');
export const quantitySchema=z.number().int().min(1).max(20);
