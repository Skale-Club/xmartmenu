'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, Mic, ShoppingBag, Bot, Trash2, Loader2 } from 'lucide-react'
import type { Product, IngredientModifications } from '@/types/database'
import type { CartEditorState } from './menu-utils'
import type { CartSnapshotItem, ResolvedCartItem } from '@/lib/chat-agent'
import { getGuestCopy } from './guest-copy'
import { fill, getMenuCopy } from './menu-i18n'
import type { PhoneContext } from './showcase'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'
import PhoneField from '@/components/ui/PhoneField'
import { useVisibleBox } from '@/components/ui/keyboard-fields'

interface Props {
  tenantSlug: string
  tenantName: string
  primaryColor?: string
  audioEnabled?: boolean
  /** Typed messages; the restaurant may allow voice notes only. */
  textEnabled?: boolean
  products: Product[]
  onAddToCart: (product: Product, selectedOptions: Record<string, unknown>, unitPrice: number, note?: string, ingredientModifications?: IngredientModifications | null, editorState?: CartEditorState | null) => void
  /** The menu and location on screen, so the assistant answers about what the customer sees. */
  menuId?: string | null
  locationId?: string | null
  onOpenCart?: () => void
  /** Mobile: the page's bottom "View order" bar is showing; the launcher sits above it. */
  orderBarVisible?: boolean
  /** The menu language on screen: the box's texts and the assistant's first language. */
  language?: string
  /** What is in the cart now, so the assistant does not re-add it and can suggest the rest. */
  cart?: CartSnapshotItem[] | null
  /** Guests can order on this menu; off (showcase) the box only answers questions about the menu. */
  canOrder?: boolean
  /** restaurant_tables.id when the guest opened a table link. */
  tableId?: string | null
  /** The restaurant's country: the phone gate starts on its calling code. */
  phoneContext?: PhoneContext | null
  /** BCP 47 locale for country names in the phone gate. */
  locale?: string
}

// Server-side cap (MAX_USER_MESSAGE_CHARS in chat-agent.ts).
const MAX_MESSAGE_CHARS = 1000

// Voice notes stop on their own at this length, so an order can be spoken
// instead of typed without clips the transcription would struggle with.
const MAX_VOICE_SECONDS = 60
// Shorter than this is an accidental tap, not a message.
const MIN_VOICE_MS = 700

function formatSeconds(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  cartItems?: Array<{ name: string; quantity: number }>
}

const SESSION_KEY_PREFIX = 'aiChat:'

export default function AiChatWidget({ tenantSlug, tenantName, primaryColor = '#F52323', audioEnabled = false, textEnabled = true, products, onAddToCart, menuId = null, locationId = null, onOpenCart, orderBarVisible = false, language = 'en', cart = null, canOrder = true, tableId = null, phoneContext = null, locale = 'en' }: Props) {
  const copy = getGuestCopy(language)
  const menuCopy = getMenuCopy(language)
  // Text and icons on the brand colour: black or white, whichever reads (never a fixed one).
  const brand = safeCssColor(primaryColor, '#18181b')
  const onBrand = computePrimaryForeground(brand)
  // Phones: the panel fills what the keyboard leaves visible, so the input bar sits right above it.
  const box = useVisibleBox()
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [phoneSubmitting, setPhoneSubmitting] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordStartedRef = useRef(0)
  const discardRecordingRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)

  // Never leave the microphone on when the widget goes away.
  useEffect(() => () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

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
      setPhoneError(data.error || copy.couldNotStart)
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
      content: fill(textEnabled ? copy.welcomeText : canOrder ? copy.welcomeVoice : copy.welcomeVoiceBrowse, { name: tenantName }),
    }])
  }

  /** `voiceToken` marks a transcript signed by the audio route (needed when typing is off). */
  async function sendMessage(text: string, voiceToken?: string) {
    if (!text.trim() || !conversationId || sending) return
    setError(null)
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    // Functional update: a voice note calls this from the recorder's callback.
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setSending(true)

    const res = await fetch(`/api/public/chat/${tenantSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Only the new message: the server rebuilds the history from what it stored.
      body: JSON.stringify({ conversation_id: conversationId, message: text.trim(), menu_id: menuId, location_id: locationId, table_id: tableId, voice_token: voiceToken, language, ...(cart ? { cart } : {}) }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || copy.somethingWrong)
      setSending(false)
      return
    }
    const data = await res.json() as { text: string; cart_items?: ResolvedCartItem[]; remaining_today: number }

    // Apply cart items via parent callback. Options, editor state and unit
    // price were resolved by the server from the menu, exactly as the product
    // modal would build them.
    const addedItems: Array<{ name: string; quantity: number }> = []
    // A view-only menu has no cart: nothing the server returns is added.
    for (const item of canOrder ? data.cart_items ?? [] : []) {
      const product = products.find((p) => p.id === item.product_id)
      if (product) {
        for (let i = 0; i < item.quantity; i++) {
          onAddToCart(product, item.selected_options, item.unit_price, item.note, null, item.editor_state)
        }
        addedItems.push({ name: item.name, quantity: item.quantity })
      }
    }

    if (addedItems.length) onOpenCart?.()

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
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(copy.micUnsupported)
      return
    }
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mr = new MediaRecorder(stream)
      audioChunksRef.current = []
      discardRecordingRef.current = false
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        const tooShort = Date.now() - recordStartedRef.current < MIN_VOICE_MS
        if (discardRecordingRef.current || tooShort) return
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' })
        await transcribeAndSend(blob)
      }
      mediaRecorderRef.current = mr
      mr.start()
      recordStartedRef.current = Date.now()
      setRecordSeconds(0)
      setRecording(true)
      recordTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordStartedRef.current) / 1000)
        setRecordSeconds(Math.min(elapsed, MAX_VOICE_SECONDS))
        if (elapsed >= MAX_VOICE_SECONDS) stopRecording()
      }, 250)
    } catch {
      setError(copy.micDenied)
    }
  }

  /** Stops the recorder; the clip is sent unless `discard`. */
  function stopRecording(discard = false) {
    discardRecordingRef.current = discard
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
    setRecording(false)
  }

  // A voice note goes out like a typed message: transcribed, then sent, so a
  // customer can speak the whole order instead of typing it.
  async function transcribeAndSend(blob: Blob) {
    if (!conversationId) return
    setTranscribing(true)
    try {
      const fd = new FormData()
      fd.append('audio', blob, blob.type.includes('mp4') ? 'voice.m4a' : blob.type.includes('ogg') ? 'voice.ogg' : 'voice.webm')
      fd.append('conversation_id', conversationId)
      const res = await fetch(`/api/public/chat/${tenantSlug}/audio`, { method: 'POST', body: fd })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || copy.transcriptionFailed)
        return
      }
      const data = await res.json() as { transcript: string; voice_token?: string | null }
      // Sent exactly as transcribed: the signature covers this text.
      const transcript = data.transcript ?? ''
      if (!transcript) {
        setError(copy.heardNothing)
        return
      }
      await sendMessage(transcript, data.voice_token ?? undefined)
    } catch {
      setError(copy.transcriptionFailed)
    } finally {
      setTranscribing(false)
    }
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className={`fixed ${orderBarVisible ? 'bottom-24 lg:bottom-6' : 'bottom-6'} right-6 z-40 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-transform hover:scale-105`}
          style={{ backgroundColor: brand, color: onBrand }}
          aria-label={copy.openChat}
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className={`fixed inset-0 z-50 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[400px] sm:h-[640px] sm:max-h-[80vh] flex flex-col bg-white sm:rounded-2xl shadow-2xl overflow-hidden`}
          style={box.keyboard ? { top: box.style.top, height: box.style.height, bottom: 'auto' } : undefined}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100" style={{ backgroundColor: brand, color: onBrand }}>
            <div className="w-8 h-8 rounded-full bg-white/25 flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold truncate">{fill(copy.askName, { name: tenantName })}</p>
              <p className="text-[12px] font-medium opacity-90">{copy.aiAssistant}</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label={copy.close} className="flex size-10 items-center justify-center rounded-full hover:bg-white/15">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Phone gate */}
          {!conversationId && (
            <form
              className={`flex-1 overflow-y-auto flex flex-col px-6 py-5 space-y-4 ${box.short ? 'justify-start' : 'justify-center'}`}
              style={{ '--accent': brand } as React.CSSProperties}
              onSubmit={(e) => { e.preventDefault(); if (!phoneSubmitting && phone.trim()) void handlePhoneSubmit() }}
            >
              <h3 className="text-lg font-bold text-zinc-900">{copy.gateTitle}</h3>
              {!box.short && <p className="text-[15px] leading-relaxed text-zinc-600">{copy.gateBody}</p>}
              <div>
                <label htmlFor="chat-phone" className="mb-1.5 block text-[14px] font-medium text-zinc-700">{menuCopy.loginPhoneLabel}</label>
                <PhoneField
                  id="chat-phone"
                  value={phone}
                  onChange={setPhone}
                  phoneContext={phoneContext}
                  locale={locale}
                  countryLabel={menuCopy.loginCountry}
                  countrySearchLabel={menuCopy.loginCountrySearch}
                  enterKeyHint="go"
                  describedBy={phoneError ? 'chat-phone-error' : undefined}
                  className="h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-[16px] text-zinc-950 placeholder:text-zinc-500 focus:border-zinc-900 focus:outline-none focus:ring-[3px] focus:ring-zinc-900/10"
                />
              </div>
              {phoneError && <p id="chat-phone-error" role="alert" className="text-[14px] font-medium text-red-700">{phoneError}</p>}
              <button
                type="submit"
                disabled={phoneSubmitting || !phone.trim()}
                className="w-full h-12 bg-zinc-900 text-white text-[16px] font-semibold rounded-xl hover:bg-zinc-800 disabled:bg-zinc-100 disabled:text-zinc-600 transition-colors"
              >
                {phoneSubmitting ? copy.starting : copy.startChat}
              </button>
            </form>
          )}

          {/* Conversation */}
          {conversationId && (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-zinc-50">
                {messages.map((m) => (
                  <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[15px] leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-zinc-900 text-white rounded-br-md'
                          : 'bg-white border border-zinc-200 text-zinc-800 rounded-bl-md'
                      }`}
                    >
                      {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
                      {m.cartItems && m.cartItems.length > 0 && (
                        <div className={`flex flex-wrap gap-1.5 ${m.content ? 'mt-2 pt-2 border-t border-zinc-100' : ''}`}>
                          {m.cartItems.map((ci, i) => (
                            <span key={i} className="inline-flex items-center gap-1 text-[12px] font-bold bg-green-50 text-green-800 px-2 py-0.5 rounded-full">
                              <ShoppingBag className="w-3 h-3" />
                              {ci.quantity}× {ci.name}
                            </span>
                          ))}
                          {onOpenCart && (
                            <button
                              type="button"
                              onClick={onOpenCart}
                              className="inline-flex items-center text-[12px] font-bold text-zinc-800 underline underline-offset-2 hover:text-zinc-900 px-1"
                            >
                              {copy.viewCart}
                            </button>
                          )}
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
                  <div role="alert" className="text-[14px] font-medium text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {error}
                  </div>
                )}
              </div>

              {/* Input bar */}
              <div className="px-3 py-3 border-t border-zinc-100 bg-white">
                {remaining !== null && remaining <= 5 && (
                  <p className="text-[12px] text-amber-800 font-bold mb-1.5 px-1">{fill(copy.remainingToday, { n: remaining })}</p>
                )}
                {recording ? (
                  <div className="flex items-center gap-2" role="status" aria-live="polite">
                    <button
                      type="button"
                      onClick={() => stopRecording(true)}
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                      aria-label={copy.discardRecording}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-red-50 border border-red-100">
                      <div className="flex items-center gap-2 text-sm font-semibold text-red-700 tabular-nums">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
                        {formatSeconds(recordSeconds)}
                        <span className="text-red-400 font-medium">/ {formatSeconds(MAX_VOICE_SECONDS)}</span>
                      </div>
                      <div className="mt-1.5 h-1 rounded-full bg-red-100 overflow-hidden">
                        <div className="h-full bg-red-500 transition-[width] duration-200" style={{ width: `${(recordSeconds / MAX_VOICE_SECONDS) * 100}%` }} />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => stopRecording()}
                      className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center hover:bg-zinc-800 flex-shrink-0"
                      aria-label={copy.stopAndSend}
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                ) : !textEnabled ? (
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={sending || transcribing || !audioEnabled}
                    className="w-full min-h-12 rounded-xl flex items-center justify-center gap-2 text-[16px] font-semibold disabled:opacity-60"
                    style={{ backgroundColor: brand, color: onBrand }}
                  >
                    {transcribing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                    {transcribing ? copy.transcribing : sending ? copy.sending : fill(copy.tapToRecord, { s: MAX_VOICE_SECONDS })}
                  </button>
                ) : (
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
                    maxLength={MAX_MESSAGE_CHARS}
                    enterKeyHint="send"
                    aria-label={copy.askMenu}
                    placeholder={transcribing ? copy.transcribing : audioEnabled && canOrder ? copy.typeOrRecord : copy.askMenu}
                    disabled={sending || transcribing}
                    className="flex-1 min-h-10 px-3 py-2 border border-zinc-300 rounded-xl text-[16px] leading-6 text-zinc-950 placeholder:text-zinc-500 resize-none focus:outline-none focus:border-zinc-900 focus:ring-[3px] focus:ring-zinc-900/10 disabled:bg-zinc-50 max-h-24"
                  />
                  {audioEnabled && (
                    <button
                      type="button"
                      onClick={startRecording}
                      disabled={sending || transcribing}
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
                      aria-label={fill(copy.recordVoice, { s: MAX_VOICE_SECONDS })}
                      title={fill(copy.recordVoice, { s: MAX_VOICE_SECONDS })}
                    >
                      {transcribing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={() => sendMessage(input)}
                    disabled={sending || !input.trim() || transcribing}
                    className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center hover:bg-zinc-800 disabled:opacity-50 flex-shrink-0"
                    aria-label={copy.send}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
