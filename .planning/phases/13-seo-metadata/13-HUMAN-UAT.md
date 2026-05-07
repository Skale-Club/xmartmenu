---
status: partial
phase: 13-seo-metadata
source: [13-VERIFICATION.md]
started: 2026-05-07T23:40:00Z
updated: 2026-05-07T23:40:00Z
---

## Current Test

[awaiting human testing on production]

## Tests

### 1. WhatsApp link preview (SEO-04)
expected: Paste https://xmartmenu.skale.club into a WhatsApp chat on a real device — XmartMenu image (dark background, logo text) appears in the link preview card, image loads without being dropped
result: [pending]

### 2. Google Rich Results Test — JSON-LD (SEO-03)
expected: Visit https://search.google.com/test/rich-results and enter https://xmartmenu.skale.club — both Organization and SoftwareApplication entities are detected with no errors or warnings
result: [pending]

### 3. JSON-LD isolation from tenant pages (SEO-03)
expected: curl -s https://xmartmenu.skale.club/{any-tenant-slug} | grep "ld+json" returns no output — JSON-LD must NOT appear on tenant menu pages
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
