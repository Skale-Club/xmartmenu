'use client'

import { useEffect, useState } from 'react'
import { MessageSquare, Ban, Download, FileText, X, RefreshCw, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConversationRow {
  id: string
  phone_hash: string
  started_at: string
  last_message_at: string
  message_count: number
  status: 'active' | 'blocked'
  admin_note: string | null
}

interface BlockedRow {
  id: string
  phone_hash: string
  blocked_at: string
  reason: string | null
}

interface ThreadMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

function shortHash(h: string) {
  return h.slice(0, 6) + '…' + h.slice(-4)
}

export default function ChatInboxClient() {
  const [tab, setTab] = useState<'conversations' | 'blocked'>('conversations')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked'>('all')
  const [rows, setRows] = useState<ConversationRow[]>([])
  const [blocked, setBlocked] = useState<BlockedRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ConversationRow | null>(null)
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [showBlockDialog, setShowBlockDialog] = useState(false)

  async function loadConversations() {
    setLoading(true)
    const res = await fetch(`/api/admin/chat-addon/conversations?status=${statusFilter}`)
    const data = await res.json()
    setRows(data.conversations ?? [])
    setLoading(false)
  }

  async function loadBlocked() {
    setLoading(true)
    const res = await fetch('/api/admin/chat-addon/blocked')
    const data = await res.json()
    setBlocked(data.blocked ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (tab === 'conversations') loadConversations()
    else loadBlocked()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter])

  async function openThread(row: ConversationRow) {
    setSelected(row)
    setThreadLoading(true)
    setBlockReason('')
    setShowBlockDialog(false)
    const res = await fetch(`/api/admin/chat-addon/conversations/${row.id}`)
    const data = await res.json()
    setThread(data.messages ?? [])
    setThreadLoading(false)
  }

  async function blockSelected() {
    if (!selected) return
    await fetch(`/api/admin/chat-addon/conversations/${selected.id}/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: blockReason.trim() || null }),
    })
    setShowBlockDialog(false)
    setSelected(null)
    await loadConversations()
  }

  async function unblock(id: string) {
    if (!confirm('Unblock this phone? They will be able to chat again.')) return
    await fetch(`/api/admin/chat-addon/blocked?id=${id}`, { method: 'DELETE' })
    await loadBlocked()
  }

  return (
    <div className="p-8 w-full">
      <div className="flex items-end justify-between pb-6 border-b border-zinc-100 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Inbox className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Administration</span>
          </div>
          <h1 className="text-4xl font-black text-zinc-950 tracking-tight">Chat Inbox</h1>
          <p className="text-sm font-bold text-zinc-500 mt-1">All conversations from your AI assistant</p>
        </div>
        <button onClick={() => tab === 'conversations' ? loadConversations() : loadBlocked()} className="p-2 text-zinc-500 hover:text-zinc-900">
          <RefreshCw className={cn('w-5 h-5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-zinc-200">
        <button
          onClick={() => setTab('conversations')}
          className={cn(
            'px-4 py-2 text-sm font-bold transition-colors -mb-px',
            tab === 'conversations' ? 'border-b-2 border-zinc-900 text-zinc-900' : 'text-zinc-500 hover:text-zinc-900'
          )}
        >
          Conversations
        </button>
        <button
          onClick={() => setTab('blocked')}
          className={cn(
            'px-4 py-2 text-sm font-bold transition-colors -mb-px',
            tab === 'blocked' ? 'border-b-2 border-zinc-900 text-zinc-900' : 'text-zinc-500 hover:text-zinc-900'
          )}
        >
          Blocked phones
        </button>
      </div>

      {tab === 'conversations' && (
        <div>
          <div className="flex gap-2 mb-4">
            {(['all', 'active', 'blocked'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide transition-colors',
                  statusFilter === s ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="text-center py-20 text-zinc-400">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 text-zinc-300" />
              <p className="font-semibold">No conversations yet</p>
              <p className="text-sm">Conversations appear here as customers chat with the assistant.</p>
            </div>
          ) : (
            <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">Phone</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">Last activity</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">Messages</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => openThread(r)} className="border-t border-zinc-100 hover:bg-zinc-50 cursor-pointer">
                      <td className="px-4 py-3 font-mono text-xs text-zinc-700">{shortHash(r.phone_hash)}</td>
                      <td className="px-4 py-3 text-xs text-zinc-500">{new Date(r.last_message_at).toLocaleString()}</td>
                      <td className="px-4 py-3 text-xs font-bold text-zinc-700">{r.message_count}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest',
                          r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        )}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'blocked' && (
        <div>
          {blocked.length === 0 ? (
            <div className="text-center py-20 text-zinc-400">
              <Ban className="w-10 h-10 mx-auto mb-3 text-zinc-300" />
              <p className="font-semibold">No phones blocked</p>
            </div>
          ) : (
            <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">Phone</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">Blocked</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">Reason</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {blocked.map((b) => (
                    <tr key={b.id} className="border-t border-zinc-100">
                      <td className="px-4 py-3 font-mono text-xs text-zinc-700">{shortHash(b.phone_hash)}</td>
                      <td className="px-4 py-3 text-xs text-zinc-500">{new Date(b.blocked_at).toLocaleString()}</td>
                      <td className="px-4 py-3 text-xs text-zinc-700">{b.reason ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => unblock(b.id)}
                          className="text-xs px-3 py-1 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                        >
                          Unblock
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Thread modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60" onClick={() => setSelected(null)}>
          <div className="bg-white w-full max-w-2xl max-h-[80vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-400 font-bold uppercase">Conversation</p>
                <p className="text-sm font-mono text-zinc-700">{shortHash(selected.phone_hash)} · {selected.message_count} messages</p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/admin/chat-addon/conversations/${selected.id}/export`}
                  className="p-2 text-zinc-500 hover:text-zinc-900 rounded-lg hover:bg-zinc-100"
                  title="Export CSV"
                >
                  <Download className="w-4 h-4" />
                </a>
                {selected.status !== 'blocked' && (
                  <button
                    onClick={() => setShowBlockDialog(true)}
                    className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide bg-red-50 text-red-700 rounded-lg hover:bg-red-100 flex items-center gap-1"
                  >
                    <Ban className="w-3.5 h-3.5" /> Block
                  </button>
                )}
                <button onClick={() => setSelected(null)} className="p-2 text-zinc-500 hover:text-zinc-900">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 bg-zinc-50 space-y-3">
              {threadLoading ? (
                <p className="text-sm text-zinc-400">Loading…</p>
              ) : thread.length === 0 ? (
                <p className="text-sm text-zinc-400">No messages.</p>
              ) : thread.map((m) => (
                <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={cn(
                    'max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
                    m.role === 'user' ? 'bg-zinc-900 text-white rounded-br-md' : 'bg-white border border-zinc-200 text-zinc-800 rounded-bl-md',
                  )}>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    <p className={cn('text-[10px] mt-1 opacity-60', m.role === 'user' ? 'text-zinc-300' : 'text-zinc-500')}>
                      {new Date(m.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {showBlockDialog && (
              <div className="px-6 py-4 border-t border-zinc-100 bg-amber-50/50 space-y-2">
                <p className="text-xs font-bold text-zinc-700">Block this number</p>
                <input
                  type="text"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowBlockDialog(false)} className="px-3 py-1.5 text-xs font-bold text-zinc-600 hover:bg-zinc-100 rounded-lg">Cancel</button>
                  <button onClick={blockSelected} className="px-3 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg flex items-center gap-1">
                    <Ban className="w-3.5 h-3.5" /> Confirm block
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
