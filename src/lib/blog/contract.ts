// =============================================================================
// src/lib/blog/contract.ts
//
// SOURCE OF TRUTH: xkedule/shared/blog-contract.ts — sync changes back.
// Ported to: skaleclub, websites, xtimator, xmartmenu (see
// .planning/initiatives/autoblog-parity/MASTER.md §3).
//
// The auto-blog data contract, shared by every Skale Club product. It exists so
// the five implementations cannot drift on the things that used to differ for
// no reason: one product called the publish flag `auto_approve` and another
// `auto_publish`; feedback was `signal: positive|negative` in one repo,
// `rating: positive|negative` in a second and `verdict: approved|rejected` in a
// third. Reading one product's code taught you nothing about the next.
//
// This file is the vocabulary, not the storage: each repo still owns its own
// Drizzle/SQL table definitions (single-site products drop `tenantId`), but the
// column names and the enum VALUES below are fixed. When a table and this file
// disagree, this file is right and the table is the bug.
//
// Pure module: types, enums and their Zod schemas. No I/O, no imports beyond
// zod, so it is safe to import from client code, server code and tests alike.
// =============================================================================
import { z } from "zod";

// ─── Generation jobs ────────────────────────────────────────────────────────

/**
 * `skipped` is not a failure: it is the generator correctly declining to run
 * (disabled, outside the posting hour, already ran this slot, not configured).
 * Keeping it distinct from `failed` is what makes "is autopost healthy?"
 * answerable without reading error strings.
 */
export const blogJobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);
export type BlogJobStatus = z.infer<typeof blogJobStatusSchema>;

/** Who asked for this run. `telegram` is an approval-card retry, not a cron tick. */
export const blogJobTriggerSchema = z.enum(["cron", "manual", "telegram"]);
export type BlogJobTrigger = z.infer<typeof blogJobTriggerSchema>;

/**
 * Where the topic came from. Recorded per job so "our RSS feeds are producing
 * worse posts than the pillar rotation" is a query, not a hunch.
 */
export const blogJobSourceSchema = z.enum(["pillar", "rss", "manual"]);
export type BlogJobSource = z.infer<typeof blogJobSourceSchema>;

/**
 * Per-stage timing on a finished job. `image` is nullable because the image
 * stage is best-effort: a post that saved without a cover records null here,
 * which is different from a post whose image took 0ms.
 */
export const durationsMsSchema = z.object({
  topic: z.number().int().nonnegative(),
  content: z.number().int().nonnegative(),
  image: z.number().int().nonnegative().nullable(),
  upload: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type DurationsMs = z.infer<typeof durationsMsSchema>;

/**
 * Why a run declined to produce a post. The generator returns one of these
 * instead of throwing, and the admin UI maps them to a human sentence — so a
 * new reason must be added here first, never invented at a call site.
 */
export const blogSkipReasonSchema = z.enum([
  "no_settings",
  "platform_disabled",
  "disabled",
  "not_configured",
  "posts_per_day_zero",
  "too_soon",
  "outside_posting_hour",
  "locked",
  "already_running",
  "no_topic_source",
]);
export type BlogSkipReason = z.infer<typeof blogSkipReasonSchema>;

// ─── Editorial feedback ─────────────────────────────────────────────────────

/**
 * CANONICAL: `approved` | `rejected`.
 *
 * Replaces skaleclub's `signal: positive|negative` and websites'
 * `rating: positive|negative`. The words matter: the editor approved or
 * rejected a draft, which is a decision, where "positive/negative" reads like a
 * sentiment score and invited both spellings to coexist.
 */
export const blogFeedbackVerdictSchema = z.enum(["approved", "rejected"]);
export type BlogFeedbackVerdict = z.infer<typeof blogFeedbackVerdictSchema>;

/** Where the decision was taken. Telegram taps and admin clicks weigh the same. */
export const blogFeedbackChannelSchema = z.enum(["admin", "telegram"]);
export type BlogFeedbackChannel = z.infer<typeof blogFeedbackChannelSchema>;

// ─── RSS ────────────────────────────────────────────────────────────────────

/**
 * `pending` items are candidates; `used` is set only AFTER the post insert
 * succeeds, so a failed generation leaves the item available for the next run.
 */
export const blogRssItemStatusSchema = z.enum(["pending", "used", "skipped"]);
export type BlogRssItemStatus = z.infer<typeof blogRssItemStatusSchema>;

// ─── Settings ───────────────────────────────────────────────────────────────

/**
 * The shape of `blog_settings` every product converges on. Single-site products
 * (skaleclub, xtimator) omit `tenantId` and treat `superAdminEnabled` as always
 * true; multi-tenant products (xkedule, websites, xmartmenu) carry both.
 *
 * `openrouterApiKey` is deliberately absent: it is never read into this shape,
 * never serialised to a client, and never logged. Callers read it from storage
 * at the moment of use and decrypt it there.
 */
export const blogSettingsContractSchema = z.object({
  /** Platform kill-switch. The whole feature is inert until a super admin flips it. */
  superAdminEnabled: z.boolean(),
  /** Super-admin-authored editorial guide. NOT tenant-editable. */
  systemPrompt: z.string(),
  /** Tenant's own on/off switch, below the platform gate. */
  enabled: z.boolean(),
  /** 0 pauses generation without losing the rest of the configuration. */
  postsPerDay: z.number().int().min(0).max(24),
  /** Anchor hour 0-23 in the TENANT's timezone. null = legacy drift mode. */
  postingHour: z.number().int().min(0).max(23).nullable(),
  seoKeywords: z.string(),
  promptStyle: z.string(),
  enableTrendAnalysis: z.boolean(),
  /** RSS is an optional topic source; off means pure pillar rotation. */
  rssEnabled: z.boolean(),
  /** true publishes immediately; false (default) queues a draft for approval. */
  autoPublish: z.boolean(),
  textModel: z.string(),
  imageModel: z.string(),
});
export type BlogSettingsContract = z.infer<typeof blogSettingsContractSchema>;

/**
 * Defaults for a brand-new row. Safe-by-default in both directions: nothing
 * generates until a super admin, a tenant and an API key all say yes, and
 * nothing publishes without a human approving it.
 */
export const BLOG_SETTINGS_DEFAULTS: BlogSettingsContract = {
  superAdminEnabled: false,
  systemPrompt: "",
  enabled: false,
  postsPerDay: 1,
  postingHour: null,
  seoKeywords: "",
  promptStyle: "",
  enableTrendAnalysis: true,
  rssEnabled: false,
  autoPublish: false,
  textModel: "",
  imageModel: "",
};

// ─── Generator result ───────────────────────────────────────────────────────

/**
 * What every product's generator returns. A skip is a first-class outcome with
 * a typed reason, never `success: false` with a message that the UI has to
 * pattern-match.
 */
export type BlogGenerationOutcome<TPost = unknown, TJob = unknown> =
  | { status: "generated"; post: TPost; job: TJob }
  | { status: "skipped"; reason: BlogSkipReason }
  | { status: "failed"; error: string; job?: TJob };

// ─── Telegram approvals ─────────────────────────────────────────────────────

/**
 * A configured Telegram destination. Stored as a plain string in a `text[]`
 * column, in one of two forms:
 *
 *   "-1001234567890"      a chat (user, group or supergroup)
 *   "-1001234567890:42"   a specific forum topic inside a supergroup
 *
 * Keeping the thread inside the same string is what lets every product add
 * forum-topic support without a second migration on a column that already
 * exists everywhere.
 */
export interface TelegramTarget {
  chatId: string;
  /** Telegram's message_thread_id, for forum topics. */
  threadId?: number;
}

/** Parse a stored `chat_ids` entry. Returns null for an unusable entry. */
export function parseTelegramTarget(raw: string): TelegramTarget | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const separator = trimmed.lastIndexOf(":");
  if (separator <= 0) {
    return /^-?\d+$/.test(trimmed) ? { chatId: trimmed } : null;
  }

  const chatId = trimmed.slice(0, separator).trim();
  const threadRaw = trimmed.slice(separator + 1).trim();
  if (!/^-?\d+$/.test(chatId)) return null;
  if (!/^\d+$/.test(threadRaw)) return null;

  const threadId = Number(threadRaw);
  // Telegram numbers message threads from 1; 0 is not a topic, it is a typo.
  if (!Number.isSafeInteger(threadId) || threadId <= 0) return { chatId };
  return { chatId, threadId };
}

/** Serialise a target back into its stored form. Inverse of parseTelegramTarget. */
export function formatTelegramTarget(target: TelegramTarget): string {
  return target.threadId ? `${target.chatId}:${target.threadId}` : target.chatId;
}

/** Parse a whole `chat_ids` column, dropping entries that cannot be used. */
export function parseTelegramTargets(raw: readonly string[] | null | undefined): TelegramTarget[] {
  if (!raw?.length) return [];
  const targets: TelegramTarget[] = [];
  for (const entry of raw) {
    const parsed = parseTelegramTarget(entry);
    if (parsed) targets.push(parsed);
  }
  return targets;
}

/** Callback payload carried by the Approve/Reject buttons on an approval card. */
export const telegramApprovalActionSchema = z.enum(["approve", "reject"]);
export type TelegramApprovalAction = z.infer<typeof telegramApprovalActionSchema>;

export const telegramApprovalCallbackSchema = z.object({
  action: telegramApprovalActionSchema,
  postId: z.number().int().positive(),
  /** Absent in single-site products. */
  tenantId: z.number().int().positive().optional(),
});
export type TelegramApprovalCallback = z.infer<typeof telegramApprovalCallbackSchema>;

// ─── AI usage logging ───────────────────────────────────────────────────────

/** The two steps the blog pipeline reports into `ai_generation_logs`. */
export const blogAiStepSchema = z.enum(["blog_post", "blog_image"]);
export type BlogAiStep = z.infer<typeof blogAiStepSchema>;

// ─── Content bounds ─────────────────────────────────────────────────────────

/**
 * Plain-text length window, measured AFTER sanitising and stripping tags.
 * Below the floor the model returned a stub or broke its HTML; above the
 * ceiling it ran away. Either way the job fails — it never publishes.
 */
export const MIN_PLAIN_TEXT_CHARS = 600;
export const MAX_PLAIN_TEXT_CHARS = 4000;

/** How long a generation lock may sit before another run may steal it. */
export const STALE_LOCK_MS = 10 * 60 * 1000;
