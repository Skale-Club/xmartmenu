'use client'
import { useEffect,useState } from 'react'

type Member={id:string;full_name:string|null;phone:string|null;created_at:string;must_change_password?:boolean}
type AccessLink={url:string;expires_at:string;recipient_user_id:string}
/** Shared by the store screen and the independently-owned super-admin tenant panels. */
export default function OwnedStaffManagement({tenantId}:{tenantId?:string}) {
  const base=tenantId?`/api/superadmin/tenants/${encodeURIComponent(tenantId)}/staff`:'/api/admin/staff'
  const [members,setMembers]=useState<Member[]>([]),[recipient,setRecipient]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[link,setLink]=useState<AccessLink|null>(null),[notice,setNotice]=useState('')
  async function refresh() {
    const response=await fetch(base,{cache:'no-store',credentials:'same-origin'}),data=await response.json()
    if(!response.ok||!Array.isArray(data))throw new Error(data.error??'Staff access is unavailable')
    setMembers(data)
  }
  useEffect(()=>{let active=true;void fetch(base,{cache:'no-store',credentials:'same-origin'}).then(async response=>{
    const data=await response.json();if(!response.ok||!Array.isArray(data))throw new Error(data.error??'Staff access is unavailable');if(active)setMembers(data)
  }).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Staff access is unavailable')});return()=>{active=false}},[base])
  async function mutate(method:'POST'|'PATCH'|'DELETE',id?:string) {
    if(busy)return;setBusy(true);setError('');setNotice('');setLink(null)
    try{
      const response=await fetch(id?`${base}/${encodeURIComponent(id)}`:base,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},
        ...(method==='POST'?{body:JSON.stringify({recipient_user_id:recipient.trim()})}:{})}),data=await response.json()
      if(!response.ok)throw new Error(data.error??'Staff access could not be updated')
      if(data.invitation||data.recovery)setLink(data.invitation??data.recovery)
      setNotice(method==='POST'?'Invitation created. Access begins only after the exact recipient accepts it.':method==='PATCH'?'Local sessions were revoked. Share the recovery link so the owner can verify their existing sign-in method.':'Store access and local sessions were revoked. The account and its history remain intact.')
      if(method==='POST')setRecipient('');await refresh()
    }catch(failure){setError(failure instanceof Error?failure.message:'Staff access is unavailable')}finally{setBusy(false)}
  }
  return <section className="space-y-6 rounded-2xl border bg-white p-6">
    <h2 className="text-xl font-bold">Staff access</h2>
    <p className="text-sm text-zinc-600">Ask the member to register with verified phone or Google and share their account ID from <a className="underline" href="/staff-access">their account page</a>. An email address cannot claim an account.</p>
    <form onSubmit={event=>{event.preventDefault();void mutate('POST')}} className="flex flex-wrap gap-3">
      <label className="flex-1 text-sm font-medium">Verified recipient account ID<input className="mt-1 w-full rounded-lg border p-3" value={recipient} onChange={event=>setRecipient(event.target.value)} required autoComplete="off" /></label>
      <button disabled={busy} className="self-end rounded-lg bg-zinc-900 px-5 py-3 text-white">Create invitation</button>
    </form>
    {error&&<p role="alert" className="text-red-700">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {link&&<div className="space-y-2 rounded-xl border bg-zinc-50 p-4"><p>Recipient: <code>{link.recipient_user_id}</code></p><p>Expires: {new Date(link.expires_at).toLocaleString()}</p><a className="block break-all underline" href={link.url}>{link.url}</a><button className="rounded-lg border px-4 py-2" onClick={()=>void navigator.clipboard.writeText(new URL(link.url,window.location.origin).href)}>Copy access link</button></div>}
    <ul className="divide-y">{members.map(member=><li key={member.id} className="flex flex-wrap items-center justify-between gap-4 py-4"><div><p className="font-medium">{member.full_name??'Staff member'}</p><p className="text-sm text-zinc-500">{member.phone??member.id}</p>{member.must_change_password&&<p className="text-sm">Recovery required</p>}</div><div className="flex gap-2"><button disabled={busy} className="rounded-lg border px-3 py-2 text-sm" onClick={()=>{if(window.confirm('Revoke this member’s local sessions and issue a recovery link?'))void mutate('PATCH',member.id)}}>Revoke sessions / recovery</button><button disabled={busy} className="rounded-lg border px-3 py-2 text-sm text-red-700" onClick={()=>{if(window.confirm('Remove this member’s store access?'))void mutate('DELETE',member.id)}}>Remove access</button></div></li>)}</ul>
  </section>
}
