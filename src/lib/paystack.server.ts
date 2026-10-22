import { assertVerifiedPayment } from './paystack-validation';
export async function gateway(secret:string,base:string,path:string,body?:unknown){
 if(base.replace(/\/$/,'')!=='https://api.paystack.co')throw new Error('Payment provider configuration must use the verified Paystack API');
 const response=await fetch(`${base.replace(/\/$/,'')}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 const result=await response.json() as {status:boolean;data:Record<string,unknown>};
 if(!response.ok||!result.status)throw new Error('The payment provider could not complete this request. Please retry or contact support.');
 return result.data;
}
export async function settleVerified(reference:string,secret:string,base:string){
 const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
 const {data:intent,error}=await supabaseAdmin.from('payment_intents').select('*').eq('reference',reference).eq('provider','paystack').maybeSingle();
 if(error||!intent)throw new Error('Payment reference not found');
 const data=await gateway(secret,base,`/transaction/verify/${encodeURIComponent(reference)}`);
 const ok=assertVerifiedPayment(data,intent as unknown as {reference:string;amount:number;currency:string});
 if(!ok){if(['failed','abandoned','reversed'].includes(String(data['status']))){await supabaseAdmin.rpc('fail_paystack',{_reference:reference});}return {success:false,status:String(data['status']??'pending'),orderId:intent.order_id};}
 const {data:orderId,error:settlement}=await supabaseAdmin.rpc('settle_paystack',{_reference:reference,_amount:Number(intent.amount),_currency:intent.currency,_provider_id:String(data['id'])});
 if(settlement)throw new Error('Payment confirmed; settlement needs another verification. Please retry.');
 return {success:true,status:'success',orderId};
}
export async function validSignature(body:string,signature:string,secret:string){
 if(!/^[a-f0-9]{128}$/i.test(signature))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-512'},false,['verify']);
 const bytes=new Uint8Array(signature.match(/.{2}/g)?.map(x=>parseInt(x,16))??[]);
 return crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(body));
}
