// Live launch-checklist scan: fetch a tenant's PUBLIC site the way a crawler
// would (homepage, robots.txt, sitemap.xml, plus the published GTM container)
// and report which checklist items are verifiably in place.
//
// Used by the MCP tool `scan_launch_checklist` so an agent can "check and
// tick" without anyone opening the panel. Only ever fetches the restaurant's
// own public menu address (custom domain or platform slug URL, resolved from
// the DB by the caller) and www.googletagmanager.com — never a caller-supplied
// URL.
//
// The "Pure detection" section (string in, findings out) is
// unit-tested in launch-checklist-signals.test.ts. Same module as the
// Websites platform's server/launchChecklistScan.ts.

export interface ScanFinding {
  /** true = verified in place; false = looked for it and it is not there. */
  ok: boolean;
  evidence: string;
}

export interface LaunchChecklistScan {
  siteUrl: string;
  scannedAt: string;
  /** Homepage fetch outcome — when this failed, findings are mostly empty. */
  homepage: { ok: boolean; status: number | null; error?: string };
  /** Keyed by checklist item key. Items the scan cannot judge are absent. */
  findings: Record<string, ScanFinding>;
}

export interface FetchedPage {
  ok: boolean;
  status: number | null;
  url: string;
  body: string;
  headers: Record<string, string>;
  error?: string;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2_000_000;

async function fetchPage(url: string): Promise<FetchedPage> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "Mozilla/5.0 (compatible; XmartMenuLaunchChecklist/1.0)" },
    });
    const text = (await res.text()).slice(0, MAX_BODY_BYTES);
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    return { ok: res.ok, status: res.status, url: res.url || url, body: text, headers };
  } catch (err) {
    return { ok: false, status: null, url, body: "", headers: {}, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Pure detection
// ---------------------------------------------------------------------------

function metaContent(html: string, attr: "name" | "property", value: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
    if (key?.toLowerCase() !== value.toLowerCase()) continue;
    return tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() ?? "";
  }
  return null;
}

function linkHref(html: string, rel: RegExp): string | null {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const relValue = tag.match(/rel\s*=\s*["']([^"']+)["']/i)?.[1];
    if (relValue && rel.test(relValue)) return tag.match(/href\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
  }
  return null;
}

const unique = (values: string[]) => Array.from(new Set(values));

export function findGtmIds(text: string): string[] {
  return unique(text.match(/\bGTM-[A-Z0-9]{4,10}\b/g) ?? []);
}

export function findGa4Ids(text: string): string[] {
  return unique(text.match(/\bG-[A-Z0-9]{6,12}\b/g) ?? []);
}

export function hasClarity(text: string): boolean {
  return /clarity\.ms\/tag|\bclarity\s*\(\s*["']|www\.clarity\.ms/i.test(text);
}

export function hasMetaPixel(text: string): boolean {
  return /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*["']init["']/i.test(text);
}

/** True when robots.txt blocks the whole site for every crawler. */
export function robotsBlocksEverything(robots: string): boolean {
  let inWildcardGroup = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(field.trim())) inWildcardGroup = value === "*";
    else if (inWildcardGroup && /^disallow$/i.test(field.trim()) && value === "/") return true;
  }
  return false;
}

export interface ScanInputs {
  siteUrl: string;
  homepage: FetchedPage;
  robots: FetchedPage | null;
  sitemap: FetchedPage | null;
  /** Published GTM container JS (gtm.js) for every GTM id found, concatenated. */
  gtmContainers: string;
}

export function deriveScanFindings(input: ScanInputs): Record<string, ScanFinding> {
  const findings: Record<string, ScanFinding> = {};
  const { homepage, robots, sitemap } = input;

  if (robots) {
    if (!robots.ok) findings.robots_txt = { ok: false, evidence: `robots.txt returned ${robots.status ?? robots.error}` };
    else if (robotsBlocksEverything(robots.body)) findings.robots_txt = { ok: false, evidence: "robots.txt disallows everything (Disallow: /)" };
    else {
      const sitemapLine = /^\s*sitemap\s*:/im.test(robots.body);
      findings.robots_txt = { ok: true, evidence: sitemapLine ? "allows crawling and lists a Sitemap" : "allows crawling (no Sitemap line)" };
    }
  }
  if (sitemap) {
    const urls = (sitemap.body.match(/<loc>/gi) ?? []).length;
    const isXml = /<(urlset|sitemapindex)\b/i.test(sitemap.body);
    findings.sitemap_xml = sitemap.ok && isXml
      ? { ok: true, evidence: `${urls} <loc> entr${urls === 1 ? "y" : "ies"}` }
      : { ok: false, evidence: `sitemap.xml returned ${sitemap.status ?? sitemap.error}${sitemap.ok ? " but is not a sitemap" : ""}` };
  }

  if (!homepage.ok) return findings;
  const html = homepage.body;
  const all = `${html}\n${input.gtmContainers}`;

  findings.https = homepage.url.startsWith("https://")
    ? { ok: true, evidence: `served over HTTPS (${homepage.url})` }
    : { ok: false, evidence: `final URL is not HTTPS: ${homepage.url}` };

  const robotsMeta = metaContent(html, "name", "robots") ?? "";
  const xRobots = homepage.headers["x-robots-tag"] ?? "";
  const noindex = /noindex/i.test(robotsMeta) || /noindex/i.test(xRobots);
  const robotsBlocked = findings.robots_txt?.ok === false && robots?.ok;
  findings.site_published = noindex
    ? { ok: false, evidence: `noindex found (${robotsMeta ? `meta robots "${robotsMeta}"` : `X-Robots-Tag "${xRobots}"`})` }
    : robotsBlocked
      ? { ok: false, evidence: "robots.txt blocks every crawler" }
      : { ok: true, evidence: "homepage is indexable (no noindex)" };

  const gtmIds = findGtmIds(html);
  findings.gtm = gtmIds.length
    ? { ok: true, evidence: `container ${gtmIds.join(", ")} on the homepage` }
    : { ok: false, evidence: "no GTM container on the homepage" };

  const ga4Ids = findGa4Ids(all);
  findings.ga4 = ga4Ids.length
    ? { ok: true, evidence: `measurement id ${ga4Ids.join(", ")}${findGa4Ids(html).length ? "" : " (inside the GTM container)"}` }
    : { ok: false, evidence: "no GA4 measurement id on the page or in the GTM container" };

  findings.clarity = hasClarity(all)
    ? { ok: true, evidence: `Clarity tag found${hasClarity(html) ? "" : " (inside the GTM container)"}` }
    : { ok: false, evidence: "no Clarity tag on the page or in the GTM container" };

  findings.meta_pixel = hasMetaPixel(all)
    ? { ok: true, evidence: `Meta Pixel found${hasMetaPixel(html) ? "" : " (inside the GTM container)"}` }
    : { ok: false, evidence: "no Meta Pixel on the page or in the GTM container" };

  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
  const description = metaContent(html, "name", "description") ?? "";
  findings.meta_titles = title && description
    ? { ok: true, evidence: `homepage title "${title.slice(0, 70)}" and a meta description` }
    : { ok: false, evidence: !title ? "homepage has no <title>" : "homepage has no meta description" };

  const ogImage = metaContent(html, "property", "og:image");
  findings.og_image = ogImage
    ? { ok: true, evidence: `og:image ${ogImage}` }
    : { ok: false, evidence: "no og:image on the homepage" };

  const icon = linkHref(html, /\bicon\b/i);
  findings.favicon = icon
    ? { ok: true, evidence: `icon ${icon}` }
    : { ok: false, evidence: "no <link rel=icon> on the homepage" };

  const ldTypes = unique(
    (html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ?? [])
      .flatMap((block) => (block.match(/"@type"\s*:\s*"([^"]+)"/g) ?? []).map((m) => m.replace(/.*"([^"]+)"$/, "$1"))),
  );
  findings.structured_data = ldTypes.length
    ? { ok: true, evidence: `JSON-LD: ${ldTypes.slice(0, 6).join(", ")} (still run the Rich Results Test)` }
    : { ok: false, evidence: "no JSON-LD on the homepage" };

  const canonical = linkHref(html, /^canonical$/i);
  findings.canonical_host = canonical
    ? { ok: true, evidence: `canonical ${canonical}` }
    : { ok: false, evidence: "no canonical link on the homepage" };

  // Verification by meta tag only proves the positive case: a property can
  // also be verified by DNS, so a missing tag is not reported as "missing".
  const gsc = metaContent(html, "name", "google-site-verification");
  if (gsc) findings.gsc_verified = { ok: true, evidence: "google-site-verification meta tag present" };
  const bing = metaContent(html, "name", "msvalidate.01");
  if (bing) findings.bing_webmaster = { ok: true, evidence: "msvalidate.01 meta tag present" };

  return findings;
}

/**
 * Fetches the live site and derives findings. `siteUrl` must come from the DB,
 * never from a caller. robots.txt is read at the host root (that is the one
 * crawlers obey); the homepage and sitemap.xml under the menu's own path.
 */
export async function scanLaunchChecklistSite(siteUrl: string): Promise<LaunchChecklistScan> {
  const base = siteUrl.replace(/\/+$/, "");
  const origin = new URL(base).origin;
  const [homepage, robots, sitemap] = await Promise.all([
    fetchPage(`${base}/`),
    fetchPage(`${origin}/robots.txt`),
    fetchPage(`${base}/sitemap.xml`),
  ]);
  const gtmIds = homepage.ok ? findGtmIds(homepage.body).slice(0, 3) : [];
  const containers = await Promise.all(
    gtmIds.map((id) => fetchPage(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`)),
  );
  return {
    siteUrl: base,
    scannedAt: new Date().toISOString(),
    homepage: { ok: homepage.ok, status: homepage.status, ...(homepage.error ? { error: homepage.error } : {}) },
    findings: deriveScanFindings({
      siteUrl: base,
      homepage,
      robots,
      sitemap,
      gtmContainers: containers.filter((c) => c.ok).map((c) => c.body).join("\n"),
    }),
  };
}
