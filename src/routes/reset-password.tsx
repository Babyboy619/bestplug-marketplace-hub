import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { SiteFrame } from '@/components/site-frame';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { pageHead } from '@/lib/metadata';
export const Route=createFileRoute('/reset-password')({head:()=>pageHead('New password','Set a new password for your BESTPLUG MARKETPLACE account.'),component:Reset});
function Reset(){const [password,setPassword]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);return <SiteFrame><main className="min-h-[65vh]"><form className="auth-panel space-y-5" onSubmit={async e=>{e.preventDefault();setBusy(true);const {error}=await supabase.auth.updateUser({password});setMessage(error?.message??'Password updated. You can now sign in with your new password.');setBusy(false);}}><h1 className="section-heading">New password</h1><label className="block text-sm">Password<Input type="password" minLength={8} required className="mt-2" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><Button disabled={busy}>{busy?'Saving…':'Save password'}</Button>{message&&<p role="status" className="text-sm text-primary">{message}</p>}</form></main></SiteFrame>;}