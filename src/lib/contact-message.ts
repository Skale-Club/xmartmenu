/**
 * The contact page's message, as a mailto: link. Until the app can send email
 * itself, submitting the form opens the guest's mail app with the message
 * written, addressed to the restaurant's public contact email.
 */
export interface ContactMessage {
  name: string
  email: string
  phone?: string
  subject: string
  message: string
}

/** Mail apps and browsers cut very long links; the body is trimmed to stay well inside that. */
const BODY_MAX = 1500

export function buildMailtoUrl(to: string, input: ContactMessage): string {
  const lines = [
    input.message.trim(),
    '',
    `Name: ${input.name.trim()}`,
    `Email: ${input.email.trim()}`,
  ]
  if (input.phone?.trim()) lines.push(`Phone: ${input.phone.trim()}`)
  const body = lines.join('\n').slice(0, BODY_MAX)
  const subject = input.subject.trim() || `Message from ${input.name.trim()}`
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
