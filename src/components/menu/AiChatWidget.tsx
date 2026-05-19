'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, Mic, MicOff, ShoppingBag, Bot } from 'lucide-react'
import type { Product, IngredientModifications } from '@/types/database'

interface Props {
  tenantSlug: string
  tenantName: string
  primaryColor?: string
  audioEnabled?: boolean
  products: Product[]
  onAddToCart: (product: Product, selectedOptions: Record<string, unknown>, unitPrice: number, note?: string, ingredientModifications?: IngredientModifications | null) => void
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  cartItems?: Array<{ name: string; quantity: number }>
}

const SESSION_KEY_PREFIX = 'aiChat:'

export default function AiChatWidget({ tenantSlug, tenantName, primaryColor = '#EEFF00', audioEnabled = false, products, onAddToCart }: Props) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [phoneSubmitting, setPhoneSubmitting] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // Restore session from storage
  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = sessionStorage.getItem(SESSION_KEY_PREFIX + tenantSlug)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.conversation_id && parsed?.phone) {
          setPhone(parsed.phone)
          setConversationId(parsed.conversation_id)
        }
      } catch { /* ignore */ }
    }
  }, [tenantSlug])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, sending])

  async function handlePhoneSubmit() {
    if (!phone.trim()) return
    setPhoneSubmitting(true)
    setPhoneError(null)
    const res = await fetch(`/api/public/chat/${tenantSlug}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone.trim() }),
    })
    setPhoneSubmitting(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setPhoneError(data.error || 'Could not start chat')
      return
    }
    const data = await res.json()
    setConversationId(data.conversation_id)
    setRemaining(Math.max(0, data.rate_limit - data.messages_today))
    sessionStorage.setItem(
      SESSION_KEY_PREFIX + tenantSlug,
      JSON.stringify({ conversation_id: data.conversation_id, phone: phone.trim() }),
    )
    // Welcome message
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      content: `Hi! I'm the ${tenantName} menu assistant. Ask me anything about our dishes — pairings, ingredients, recommendations — or tell me what you're in the mood for and I'll suggest something.`,
    }])
  }

  async function sendMessage(text: string) {
    if (!text.trim() || !conversationId || sending) return
    setError(null)
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    const next: Message[] = [...messages.filter((m) => m.id !== 'welcome'), userMsg]
    setMessages([...messages, userMsg])
    setInput('')
    setSending(true)

    const res = await fetch(`/api/public/chat/${tenantSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        messages: next.map((m) => ({ role: m.role, content: m.content })),
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Something went wrong')
      setSending(false)
      return
    }
    const data = await res.json() as { text: string; cart_items?: Array<{ product_id: string; name: string; quantity: number; unit_price: number; note?: string }>; remaining_today: number }

    // Apply cart items via parent callback
    const addedItems: Array<{ name: string; quantity: number }> = []
    for (const item of data.cart_items ?? []) {
      const product = products.find((p) => p.id === item.product_id)
      if (product) {
        for (let i = 0; i < item.quantity; i++) {
          onAddToCart(product, {}, item.unit_price ?? product.price, item.note, null)
        }
        addedItems.push({ name: item.name, quantity: item.quantity })
      }
    }

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: data.text,
      cartItems: addedItems.length ? addedItems : undefined,
    }
    setMessages((prev) => [...prev, assistantMsg])
    setRemaining(data.remaining_today)
    setSending(false)
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone not supported on this browser')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      audioChunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' })
        await transcribeAndFill(blob)
      }
      mediaRecorderRef.current = mr
      mr.start()
      setRecording(true)
    } catch (e) {
      setError('Microphone permission denied')
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  async function transcribeAndFill(blob: Blob) {
    if (!conversationId) return
    const fd = new FormData()
    fd.append('audio', blob, 'voice.webm')
    fd.append('conversation_id', conversationId)
    const res = await fetch(`/api/public/chat/${tenantSlug}/audio`, { method: 'POST', body: fd })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Transcription failed')
      return
    }
    const data = await res.json() as { transcript: string }
    setInput((prev) => (prev ? `${prev} ${data.transcript}` : data.transcript))
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-transform hover:scale-105"
          style={{ backgroundColor: primaryColor }}
          aria-label="Open AI chat"
        >
          <MessageCircle className="w-6 h-6 text-zinc-900" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed inset-0 z-50 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[400px] sm:h-[640px] sm:max-h-[80vh] flex flex-col bg-white sm:rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100" style={{ backgroundColor: primaryColor }}>
            <div className="w-8 h-8 rounded-full bg-white/30 flex items-center justify-center">
              <Bot className="w-4 h-4 text-zinc-900" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-zinc-900 truncate">Ask {tenantName}</p>
              <p className="text-[10px] text-zinc-700 font-medium">AI menu assistant</p>
            </div>
            <button onClick={() => setOpen(false)} className="p-1.5 text-zinc-700 hover:text-zinc-900">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Phone gate */}
          {!conversationId && (
            <div className="flex-1 flex flex-col justify-center px-6 space-y-4">
              <h3 className="text-lg font-bold text-zinc-900">Chat with our AI assistant</h3>
              <p className="text-sm text-zinc-600">Share your phone number to start. We use it only to keep your conversation tied to you.</p>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 555 5555"
                className="w-full px-4 py-3 border border-zinc-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
              {phoneError && <p className="text-sm text-red-600">{phoneError}</p>}
              <button
                onClick={handlePhoneSubmit}
                disabled={phoneSubmitting || !phone.trim()}
                className="w-full py-3 bg-zinc-900 text-white text-sm font-bold rounded-xl hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {phoneSubmitting ? 'Starting…' : 'Start chat'}
              </button>
            </div>
          )}

          {/* Conversation */}
          {conversationId && (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-zinc-50">
                {messages.map((m) => (
                  <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-zinc-900 text-white rounded-br-md'
                          : 'bg-white border border-zinc-200 text-zinc-800 rounded-bl-md'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      {m.cartItems && m.cartItems.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-zinc-100 flex flex-wrap gap-1.5">
                          {m.cartItems.map((ci, i) => (
                            <span key={i} className="inline-flex items-center gap-1 text-[10px] font-bold bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                              <ShoppingBag className="w-3 h-3" />
                              {ci.quantity}× {ci.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-zinc-200 px-4 py-3 rounded-2xl rounded-bl-md">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                {error && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {error}
                  </div>
                )}
              </div>

              {/* Input bar */}
              <div className="px-3 py-3 border-t border-zinc-100 bg-white">
                {remaining !== null && remaining <= 5 && (
                  <p className="text-[10px] text-amber-600 font-bold mb-1.5 px-1">{remaining} message{remaining === 1 ? '' : 's'} remaining today</p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendMessage(input)
                      }
                    }}
                    rows={1}
                    placeholder={recording ? 'Recording…' : 'Ask about our menu…'}
                    disabled={sending || recording}
                    className="flex-1 px-3 py-2 border border-zinc-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:bg-zinc-50 max-h-24"
                  />
                  {audioEnabled && (
                    <button
                      type="button"
                      onClick={recording ? stopRecording : startRecording}
                      disabled={sending}
                      className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                        recording ? 'bg-red-500 text-white animate-pulse' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                      }`}
                      aria-label={recording ? 'Stop recording' : 'Start recording'}
                    >
                      {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={() => sendMessage(input)}
                    disabled={sending || !input.trim() || recording}
                    className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center hover:bg-zinc-800 disabled:opacity-50 flex-shrink-0"
                    aria-label="Send"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
