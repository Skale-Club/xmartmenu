// =============================================================================
// src/lib/blog/schedule.ts
//
// SOURCE OF TRUTH: xkedule/shared/blog-schedule.ts — sync changes back.
// Ported here as part of the auto-blog parity work (autoblog-parity XM-04, see
// .planning/initiatives/autoblog-parity/MASTER.md §5). Unchanged below this
// header: pure, takes its own clock, no notion of tenancy.
// =============================================================================
/** Hours (0-23, tenant local) at which a post should be generated. */
export function scheduledHours(postingHour: number | null | undefined, postsPerDay: number): number[] {
  if (postingHour === null || postingHour === undefined) return [];
  if (!Number.isInteger(postingHour) || postingHour < 0 || postingHour > 23) return [];
  if (!Number.isInteger(postsPerDay) || postsPerDay <= 0) return [];

  const perDay = Math.min(postsPerDay, 24);
  const spacing = 24 / perDay;
  const hours: number[] = [];
  for (let i = 0; i < perDay; i++) {
    hours.push(Math.round(postingHour + i * spacing) % 24);
  }
  // A non-integer spacing (postsPerDay 5, 7, ...) can round two slots onto the
  // same hour; collapsing them keeps "one post per slot" honest.
  return Array.from(new Set(hours)).sort((a, b) => a - b);
}

/**
 * The wall-clock hour and calendar day in `timeZone` for an instant.
 * Uses Intl rather than manual offset maths so DST is handled by the platform.
 * Falls back to UTC when the timezone is unusable, which is what every other
 * date-formatting path in the app does rather than throwing on bad config.
 */
export function zonedHourAndDay(at: Date, timeZone: string): { hour: number; day: string } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
    }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
    }).formatToParts(at);
  }

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl renders midnight as "24" in some locales/engines; normalise to 0.
  const hour = Number(get("hour")) % 24;
  return { hour, day: `${get("year")}-${get("month")}-${get("day")}` };
}

export interface ScheduleDecision {
  /** True when a run is due in the current hour. */
  due: boolean;
  /** Why not, for the cron log. */
  reason?: "not_scheduled_hour" | "already_ran_this_hour";
}

/**
 * Should a run happen right now?
 *
 * A run is due when the tenant's local hour is one of the scheduled slots and
 * the last run did not already happen inside that same local hour. Comparing
 * the hour SLOT (not elapsed time) is what makes this idempotent against the
 * cron firing twice in an hour, without re-introducing drift.
 */
export function isRunDue(args: {
  now: Date;
  timeZone: string;
  postingHour: number | null | undefined;
  postsPerDay: number;
  lastRunAt: Date | null | undefined;
}): ScheduleDecision {
  const hours = scheduledHours(args.postingHour, args.postsPerDay);
  if (hours.length === 0) return { due: false, reason: "not_scheduled_hour" };

  const nowLocal = zonedHourAndDay(args.now, args.timeZone);
  if (!hours.includes(nowLocal.hour)) return { due: false, reason: "not_scheduled_hour" };

  if (args.lastRunAt) {
    const lastLocal = zonedHourAndDay(args.lastRunAt, args.timeZone);
    if (lastLocal.day === nowLocal.day && lastLocal.hour === nowLocal.hour) {
      return { due: false, reason: "already_ran_this_hour" };
    }
  }

  return { due: true };
}

/**
 * The next instant a post is due, for the admin panel to display. Returns null
 * when no hour is configured (the tenant is on the drifting cadence, which has
 * no predictable next time — which is the whole reason this exists).
 *
 * Scans forward hour by hour over two days rather than computing an offset:
 * a DST transition makes "add N hours" and "the next 09:00 local" different
 * instants, and the one the tenant means is the second.
 */
export function nextScheduledRun(args: {
  now: Date;
  timeZone: string;
  postingHour: number | null | undefined;
  postsPerDay: number;
}): Date | null {
  const hours = scheduledHours(args.postingHour, args.postsPerDay);
  if (hours.length === 0) return null;

  const startOfHour = new Date(args.now);
  startOfHour.setUTCMinutes(0, 0, 0);

  for (let i = 1; i <= 48; i++) {
    const candidate = new Date(startOfHour.getTime() + i * 3600_000);
    if (hours.includes(zonedHourAndDay(candidate, args.timeZone).hour)) return candidate;
  }
  return null;
}
