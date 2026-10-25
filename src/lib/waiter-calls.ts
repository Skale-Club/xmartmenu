/**
 * "Call the waiter" from a table's menu link (pure rules; routes in
 * src/app/api/public/waiter-call and src/app/api/admin/waiter-calls).
 *
 * A guest on a table link (?table=<id>) can call a waiter or ask for the bill
 * whenever the restaurant serves at the table: waiter ordering or guest
 * ordering is on (service-modes.ts). A second tap on the same request while it
 * is still open does not create another call, it just reminds the staff.
 */
import type { ServiceCapabilities } from './service-modes'

export type WaiterCallReason = 'waiter' | 'bill'
export type WaiterCallStatus = 'open' | 'acknowledged' | 'done'

export interface WaiterCall {
  id: string
  table_id: string | null
  table_name: string
  reason: WaiterCallReason
  status: WaiterCallStatus
  created_at: string
  /** Bumped when the guest taps again while the call is open. */
  last_called_at?: string | null
  acknowledged_at: string | null
}

export function canCallWaiter(capabilities: Pick<ServiceCapabilities, 'waiterOrdering' | 'guestOrdering'>): boolean {
  return capabilities.waiterOrdering || capabilities.guestOrdering
}

export function parseCallReason(value: unknown): WaiterCallReason {
  return value === 'bill' ? 'bill' : 'waiter'
}

export function parseCallStatus(value: unknown): Exclude<WaiterCallStatus, 'open'> | null {
  return value === 'acknowledged' || value === 'done' ? value : null
}

/** Calls older than this are treated as stale and leave the staff screens. */
export const CALL_STALE_MS = 2 * 60 * 60 * 1000

/** Open (not done) calls for the screens, oldest first, without stale ones. */
export function activeCalls<T extends Pick<WaiterCall, 'status' | 'created_at'>>(calls: T[], now = Date.now()): T[] {
  return calls
    .filter(c => c.status !== 'done' && now - new Date(c.created_at).getTime() < CALL_STALE_MS)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** Replaces or adds a call by id (realtime INSERT/UPDATE). */
export function upsertCall<T extends { id: string }>(calls: T[], next: T): T[] {
  return calls.some(c => c.id === next.id) ? calls.map(c => (c.id === next.id ? { ...c, ...next } : c)) : [...calls, next]
}

export const CALL_REASON_LABELS: Record<WaiterCallReason, string> = {
  waiter: 'Calling a waiter',
  bill: 'Asking for the bill',
}

/** "3 min ago" style label for the staff screens. */
export function waitingFor(createdAt: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000))
  return minutes < 1 ? 'just now' : `${minutes} min ago`
}
