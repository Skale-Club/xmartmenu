/**
 * sanitizeForPrompt | strips characters that could break LLM prompt structure.
 * Used by all AI routes (Phase 9 text seeding, Phase 10 image seeding, Phase 11 OCR).
 * Per D-11: strips backticks, {, }, <, >, newlines; normalizes whitespace; truncates.
 * Per OWASP LLM Top 10 #1 (prompt injection mitigation).
 */
export function sanitizeForPrompt(str: string, maxLength = 100): string {
  return str
    .replace(/[`{}<>\n\r]/g, '')   // strip prompt-structure chars
    .replace(/\s+/g, ' ')           // normalize whitespace
    .trim()
    .slice(0, maxLength)
}
