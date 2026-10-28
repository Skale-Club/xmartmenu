'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, Mail, MapPin, Phone } from 'lucide-react'
import { buildMailtoUrl } from '@/lib/contact-message'
import { computePrimaryForeground } from '@/lib/color-utils'

const fieldClass = 'w-full rounded-xl border border-zinc-200 bg-white px-4 text-[16px] text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400'
const labelClass = 'mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500'

/**
 * "Get in touch": name, email, phone (optional), subject and message. For now
 * sending opens the guest's mail app with the message written to the
 * restaurant's contact email; the page says so plainly and keeps the address
 * in view, so a guest whose mail app does not open can still write.
 */
export default function ContactForm({
  tenantName,
  backHref,
  primaryColor,
  contactEmail,
  phone,
  instagram,
  address,
  pickup,
}: {
  tenantName: string
  backHref: string
  primaryColor: string
  contactEmail: string
  phone: { url: string; label: string } | null
  instagram: { url: string; handle: string } | null
  address: string | null
  pickup: boolean
}) {
  const onPrimary = computePrimaryForeground(primaryColor)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [opened, setOpened] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    window.location.href = buildMailtoUrl(contactEmail, { name, email, phone: guestPhone, subject, message })
    setOpened(true)
  }

  return (
    <main className="min-h-screen bg-menu px-4 pb-16 pt-6 text-zinc-900">
      <div className="mx-auto max-w-xl">
        <Link href={backHref} className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-zinc-600 hover:text-zinc-900">
          <ArrowLeft className="size-4" aria-hidden="true" /> {tenantName}
        </Link>

        <header className="mt-4 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">Get in touch</p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight">Questions, special orders, anything else.</h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-zinc-600">
            Drop us a note and we&rsquo;ll get back to you.
          </p>
        </header>

        <ul className="mt-6 space-y-2 text-center text-[15px] text-zinc-700">
          {phone ? (
            <li className="flex items-center justify-center gap-2">
              <Phone className="size-4 text-zinc-400" aria-hidden="true" />
              <span>Call or text us at <a href={phone.url} className="font-semibold underline underline-offset-2 hover:text-zinc-950">{phone.label}</a></span>
            </li>
          ) : null}
          {address ? (
            <li className="flex items-center justify-center gap-2">
              <MapPin className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
              <span>
                {pickup ? 'Pickup: ' : ''}
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2 hover:text-zinc-950">{address}</a>
              </span>
            </li>
          ) : null}
          {instagram ? (
            <li>
              Or find us on{' '}
              <a href={instagram.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2 hover:text-zinc-950">Instagram</a>
            </li>
          ) : null}
        </ul>

        <form onSubmit={submit} className="mt-6 space-y-5 rounded-3xl bg-white p-5 shadow-card sm:p-7">
          <div>
            <label htmlFor="contact-name" className={labelClass}>Name</label>
            <input id="contact-name" required autoComplete="name" value={name} onChange={e => setName(e.target.value)} className={`${fieldClass} h-12`} />
          </div>
          <div>
            <label htmlFor="contact-email" className={labelClass}>Email</label>
            <input id="contact-email" required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className={`${fieldClass} h-12`} />
          </div>
          <div>
            <label htmlFor="contact-phone" className={labelClass}>Phone (optional)</label>
            <input id="contact-phone" type="tel" autoComplete="tel" value={guestPhone} onChange={e => setGuestPhone(e.target.value)} className={`${fieldClass} h-12`} />
          </div>
          <div>
            <label htmlFor="contact-subject" className={labelClass}>Subject</label>
            <input id="contact-subject" required value={subject} onChange={e => setSubject(e.target.value)} placeholder="Whole cake, gifting, etc." className={`${fieldClass} h-12`} />
          </div>
          <div>
            <label htmlFor="contact-message" className={labelClass}>Message</label>
            <textarea id="contact-message" required rows={5} value={message} onChange={e => setMessage(e.target.value)} className={`${fieldClass} py-3`} />
          </div>

          <button
            type="submit"
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl px-6 text-base font-semibold shadow-float transition-[opacity,scale] hover:opacity-95 active:scale-[0.98]"
            style={{ backgroundColor: primaryColor, color: onPrimary }}
          >
            <Mail className="size-5" aria-hidden="true" /> Send message
          </button>

          <p className="text-center text-[13px] leading-relaxed text-zinc-500" aria-live="polite">
            {opened
              ? <>Your email app should have opened with the message ready to send. If not, write to <a href={`mailto:${contactEmail}`} className="font-semibold underline underline-offset-2">{contactEmail}</a>.</>
              : <>Sending opens your email app with your message ready, addressed to {contactEmail}.</>}
          </p>
        </form>
      </div>
    </main>
  )
}
