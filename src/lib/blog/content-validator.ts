// src/lib/blog/content-validator.ts
//
// SOURCE OF TRUTH: skaleclub/server/blog/content-validator.ts — sync changes back.
// Ported here from Skale Club (see
// .planning/initiatives/autoblog-parity/MASTER.md §5).
//
// Phase 36 — BLOG2-02, BLOG2-03 (helpers consumed by Plan 36-03)
//
// Pure module: HTML sanitizer, plain-text length, slug generator, and
// typed Gemini error classes. No DB calls, no Gemini calls, no env reads.
//
// Decisions implemented:
// - D-01: sanitize-html as canonical sanitizer
// - D-02: strict tag allowlist (p, h2, h3, ul, ol, li, strong, em, a, blockquote)
// - D-03: <a> attribute policy — href only; force rel/target; http(s) only
// - D-04: inline NFD-normalize slugifyTitle (80-char cap)
// - D-14: dedicated module location for sanitizer + error classes
// - D-15: SANITIZE_OPTS config at top of file (single source of truth)

import sanitizeHtml from "sanitize-html";

// ─── D-02 / D-15: tag allowlist + module-level sanitizer config ──────────

export const ALLOWED_BLOG_TAGS = [
  "p",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "a",
  "blockquote",
] as const;

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_BLOG_TAGS],
  // sanitize-html applies allowedAttributes AFTER transformTags, so any
  // attribute forced by the transform must also appear here or it gets
  // filtered out. We allow `href` (model-supplied) plus `rel`+`target`
  // (transform-supplied). Per D-03 the model can ONLY supply href; rel/
  // target on incoming anchors are overwritten by the transform below.
  allowedAttributes: { a: ["href", "rel", "target"] },
  allowedSchemes: ["http", "https"],
  // D-15: force safe rel/target on every surviving anchor, overwriting
  // anything the model emitted.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName: "a",
      attribs: {
        ...attribs,
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      },
    }),
  },
};

// ─── BLOG2-02: HTML sanitizer ────────────────────────────────────────────

/**
 * Strip every tag/attribute outside the strict blog allowlist (D-02).
 * Surviving <a> tags are forced to rel="noopener noreferrer nofollow"
 * target="_blank" regardless of what the model emitted (D-03 / D-15).
 * Disallowed schemes (javascript:, data:, mailto:, tel:) drop the anchor
 * entirely while keeping its text content.
 */
export function sanitizeBlogHtml(html: string): string {
  if (!html) return "";
  return sanitizeHtml(html, SANITIZE_OPTS);
}

// ─── D-05 helper: plain-text length after tag removal ───────────────────

/**
 * Strip all HTML tags, decode the few entities sanitize-html may leave
 * behind, collapse whitespace, and return the resulting character count.
 * Used by Plan 36-03 to enforce the 600..4000 plain-text length window.
 */
export function getPlainTextLength(html: string): number {
  if (!html) return 0;

  // sanitize-html with allowedTags: [] strips every tag and decodes the
  // standard entity set the same way the canonical sanitizer would.
  const stripped = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
  });

  const collapsed = stripped.replace(/\s+/g, " ").trim();
  return collapsed.length;
}

// ─── D-04: NFD-normalized slug generator ────────────────────────────────

/**
 * Lowercase, NFD-strip diacritics, hyphenate non-alphanumerics, trim
 * leading/trailing hyphens, cap at 80 chars. Caller (Plan 36-03's
 * buildSlug) appends the timestamp suffix for uniqueness.
 */
export function slugifyTitle(title: string): string {
  if (!title) return "";
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, ""); // re-trim if slice cut mid-hyphen-run
}

// ─── D-08 / D-07: typed errors thrown at the generator's AI call sites ──
// (provider-neutral since the OpenRouter port; formerly Gemini*Error)

export class AiTimeoutError extends Error {
  constructor(message: string = "AI provider call timed out") {
    super(message);
    this.name = "AiTimeoutError";
  }
}

export class AiEmptyResponseError extends Error {
  constructor(message: string = "AI provider returned an empty response") {
    super(message);
    this.name = "AiEmptyResponseError";
  }
}
