'use client'

import { useState, useEffect } from 'react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Users, UserPlus, Trash2, Key, CheckCircle2, AlertCircle, Save, Info, Mail, User, ShieldCheck, X, Clipboard, ExternalLink, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StaffMember {
  id: string
  email: string | null
  full_name: string | null
  phone: string | null
  created_at: string
}

interface Credentials {
  email: string
  password: string
}

interface StaffPayload {
  id: string | null
  email: string
  full_name: string
}

export default function StaffClient() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite form
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [credentialsOwner, setCredentialsOwner] = useState<StaffPayload | null>(null)

  // Delete confirm
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmName, setConfirmName] = useState('')

  useEffect(() => {
    fetch('/api/admin/staff')
      .then(r => r.json())
      .then(data => { setStaff(data); setLoading(false) })
      .catch(() => { setError('Failed to load staff'); setLoading(false) })
  }, [])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteLoading(true)
    setError(null)

    const res = await fetch('/api/admin/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: inviteName, email: inviteEmail }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error)
    } else {
      setCredentials(data.credentials)
      setCredentialsOwner(data.staff ?? null)
      setStaff(prev => [...prev, {
        id: data.staff?.id ?? crypto.randomUUID(),
        email: data.staff?.email ?? inviteEmail,
        full_name: data.staff?.full_name ?? inviteName,
        phone: null,
        created_at: new Date().toISOString(),
      }])
      setInviteName('')
      setInviteEmail('')
    }
    setInviteLoading(false)
  }

  async function handleRemove() {
    if (!confirmId) return
    const res = await fetch(`/api/admin/staff/${confirmId}`, { method: 'DELETE' })
    if (res.ok) {
      setStaff(prev => prev.filter(s => s.id !== confirmId))
    } else {
      const data = await res.json()
      setError(data.error)
    }
    setConfirmId(null)
  }

  async function handleResetPassword(member: StaffMember) {
    setError(null)
    const res = await fetch(`/api/admin/staff/${member.id}`, { method: 'PATCH' })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to generate new password')
      return
    }
    setCredentials(data.credentials)
    setCredentialsOwner(data.staff ?? { id: member.id, email: member.email, full_name: member.full_name ?? '' })
  }

  const inputClassName = "w-full px-5 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
  const labelClassName = "block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 ml-1"

  return (
    <div className="p-8 w-full space-y-10">
      <ConfirmDialog
        open={!!confirmId}
        title="Revoke Access"
        message={`Are you sure you want to remove "${confirmName}" from your team? They will immediately lose access to the platform.`}
        confirmLabel="Remove Member"
        onConfirm={handleRemove}
        onCancel={() => setConfirmId(null)}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Team Control</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">Staff Management</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">Manage permissions and team access for your store</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-[1rem] px-8 py-4 text-sm font-bold text-red-600 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
          <button onClick={() => setError(null)} className="p-2 hover:bg-red-100 rounded-full transition-colors">✕</button>
        </div>
      )}

      {/* Credentials Overlay/Card */}
      {credentials && (
        <div className="bg-zinc-950 rounded-[1.5rem] p-8 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-[80px] -mr-32 -mt-32" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-zinc-950" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-white tracking-tight leading-tight">Access Credentials</h3>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Secure transmission required</p>
                </div>
              </div>
              <button onClick={() => { setCredentials(null); setCredentialsOwner(null) }} className="p-2 bg-white/5 rounded-full text-zinc-500 hover:text-white transition-colors"><X className="w-6 h-6" /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Email / Login</p>
                  <p className="text-lg font-bold text-white font-mono">{credentials.email}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Temporary Password</p>
                  <p className="text-lg font-bold text-primary font-mono tracking-wider">{credentials.password}</p>
                </div>
              </div>
              <div className="flex flex-col justify-center p-6 space-y-4">
                <p className="text-xs text-zinc-400 leading-relaxed font-medium">
                  Provide these credentials to <span className="text-white font-bold">{credentialsOwner?.full_name}</span>. They will be prompted to change their password upon their first login.
                </p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(`Email: ${credentials.email}\nPassword: ${credentials.password}`)
                    }}
                    className="flex-1 bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                  >
                    <Clipboard className="w-4 h-4" />
                    Copy Details
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Invite Form */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-zinc-100 rounded-[1.25rem] p-8 shadow-sm h-fit sticky top-8">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <UserPlus className="w-4 h-4 text-primary" />
              </div>
              <h2 className="text-xl font-black text-zinc-950 tracking-tight">Add Member</h2>
            </div>
            
            <form onSubmit={handleInvite} className="space-y-6">
              <div className="space-y-4">
                <div>
                  <label className={labelClassName}>Full Name</label>
                  <div className="relative">
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400">
                      <User className="w-5 h-5" />
                    </div>
                    <input
                      required
                      value={inviteName}
                      onChange={e => setInviteName(e.target.value)}
                      placeholder="Jane Doe"
                      className={cn(inputClassName, "pl-14")}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClassName}>Email Address</label>
                  <div className="relative">
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400">
                      <Mail className="w-5 h-5" />
                    </div>
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="jane@restaurant.com"
                      className={cn(inputClassName, "pl-14")}
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={inviteLoading}
                className="w-full bg-zinc-950 text-white py-4 rounded-xl text-sm font-black uppercase tracking-widest hover:bg-primary hover:text-primary-foreground transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-zinc-950/10 flex items-center justify-center gap-2"
              >
                {inviteLoading ? 'Sending...' : (
                  <>
                    <Plus className="w-4 h-4" />
                    Invite Member
                  </>
                )}
              </button>
              
              <p className="text-[10px] font-medium text-zinc-400 text-center leading-relaxed px-4 italic">
                New members will receive staff permissions to manage menus and orders.
              </p>
            </form>
          </div>
        </div>

        {/* Staff List */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-zinc-100 rounded-[1.5rem] overflow-hidden shadow-sm">
            <div className="px-10 py-8 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <h2 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Active Team Members</h2>
              <span className="bg-zinc-950 text-white text-[9px] font-black px-3 py-1 rounded-full">{staff.length} Active</span>
            </div>
            
            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center space-y-4">
                <div className="w-8 h-8 border-4 border-zinc-100 border-t-primary rounded-full animate-spin" />
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Fetching Team...</p>
              </div>
            ) : staff.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center text-center px-10">
                <div className="w-16 h-16 bg-zinc-50 rounded-xl flex items-center justify-center mb-4">
                  <Users className="w-8 h-8 text-zinc-200" />
                </div>
                <h3 className="text-lg font-black text-zinc-950 tracking-tight mb-1">Your team is empty</h3>
                <p className="text-sm text-zinc-500 font-medium">Add staff members to help you manage your digital presence.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-50">
                {staff.map(member => (
                  <div key={member.id} className="group flex flex-col sm:flex-row sm:items-center justify-between gap-6 px-10 py-8 hover:bg-zinc-50/50 transition-colors">
                    <div className="flex items-center gap-6">
                      <div className="w-14 h-14 rounded-xl bg-zinc-100 flex items-center justify-center text-xl font-black text-zinc-300 border border-zinc-200 shadow-inner group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                        {getInitials(member.full_name ?? member.email ?? '')}
                      </div>
                      <div>
                        <p className="text-lg font-black text-zinc-950 tracking-tight leading-tight">{member.full_name ?? 'N/A'}</p>
                        <p className="text-sm font-bold text-zinc-500 flex items-center gap-2 mt-1">
                          <Mail className="w-3.5 h-3.5" />
                          {member.email}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex flex-col sm:items-end gap-3">
                      <div className="flex items-center gap-2 sm:mb-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Joined</span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-950">{new Date(member.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-x-4 group-hover:translate-x-0">
                        <button
                          onClick={() => void handleResetPassword(member)}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 text-[10px] font-black uppercase tracking-widest text-zinc-600 hover:bg-white hover:text-zinc-950 transition-all shadow-sm"
                        >
                          <Key className="w-3.5 h-3.5" />
                          Regen Pass
                        </button>
                        <button
                          onClick={() => { setConfirmId(member.id); setConfirmName(member.full_name ?? member.email ?? '') }}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-50 text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50 transition-all shadow-sm"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="mt-8 bg-zinc-50 rounded-[1.25rem] p-8 border border-zinc-100 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm">
              <ShieldCheck className="w-5 h-5 text-zinc-400" />
            </div>
            <p className="text-xs font-bold text-zinc-500 leading-relaxed max-w-lg">
              Staff members can access the dashboard to manage menus, products, and orders, but cannot modify critical store settings or billing information.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

