/**
 * Link unfurling — fetches an external page server-side (browsers can't: CORS)
 * and extracts the metadata a hover preview card needs: title, description,
 * Open Graph image (+ declared dimensions, which decide the card's
 * orientation), site name, and favicon.
 *
 * The app is local-first and must keep working without a Node runtime
 * (Capacitor / static builds): clients treat any failure here as "no preview"
 * and fall back to a plain domain card, so this route is best-effort by design.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const UA = "Mozilla/5.0 (compatible; AquariusLinkPreview/1.0)";
const MAX_HTML = 512 * 1024; // metadata lives in <head>; don't stream whole pages
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 6_000;

// ─── SSRF guard: only fetch public hosts, re-checked on every redirect hop ────

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7)); // v4-mapped
    return v6 === "::" || v6 === "::1" || v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd");
  }
  const p = ip.split(".").map(Number);
  return (
    p[0] === 0 || p[0] === 10 || p[0] === 127 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || // CGNAT
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168)
  );
}

/** Throws unless the URL is http(s) to a publicly-routable host. */
async function assertPublicUrl(u: URL): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
  const host = u.hostname;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("host");
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("ip");
    return;
  }
  const addrs = await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new Error("resolve");
}

// ─── Fetch with manual redirects (each hop re-validated) and a body cap ───────

async function fetchPage(target: URL): Promise<{ finalUrl: URL; html: string | null }> {
  let url = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      void res.body?.cancel().catch(() => {});
      if (!loc) throw new Error("redirect");
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok) throw new Error(`status ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) {
      void res.body?.cancel().catch(() => {});
      return { finalUrl: url, html: null }; // a PDF/image/… — no metadata to parse
    }
    return { finalUrl: url, html: await readCapped(res) };
  }
  throw new Error("too many redirects");
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let html = "";
  let read = 0;
  while (read < MAX_HTML) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    html += decoder.decode(value, { stream: true });
  }
  void reader.cancel().catch(() => {});
  return html;
}

// ─── Minimal head parsing (regex — full HTML parsing is overkill for <meta>) ──
// All tag-matching quantifiers are BOUNDED (`{0,N}`, not `*`): an unbounded
// `[^>]*` before another token backtracks catastrophically (O(n²)) on a hostile
// body full of `<meta ` with no closing `>`, blocking the event loop. We also
// parse only the <head> slice and extract every tag ONCE, then read attributes
// off the short tag strings, so the full body is never rescanned per-key.

const MAX_PARSE = 128 * 1024; // metadata lives in <head>; cap what we scan
const MAX_TAG = 4096; // longest <meta>/<link> we'll consider (bounds backtracking)

/** The <head> region (or a capped prefix if the page never closes it). */
function headSlice(html: string): string {
  const end = /<\/head\s*>/i.exec(html)?.index ?? -1;
  const head = end >= 0 ? html.slice(0, end) : html;
  return head.length > MAX_PARSE ? head.slice(0, MAX_PARSE) : head;
}

const codePoint = (n: number): string =>
  n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; // out-of-range would throw

const decodeEntities = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, d: string) => codePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");

/** `content` of the given attribute in one tag string (bounded, order-agnostic). */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}=["']([^"']*)["']`, "i").exec(tag);
  return m ? m[1] : undefined;
}

/** All `<name …>` tags in a bounded, non-backtracking pass. */
const tagsOf = (html: string, name: string): string[] =>
  html.match(new RegExp(`<${name}\\b[^>]{0,${MAX_TAG}}>`, "gi")) ?? [];

/** `content` of the first `<meta name|property="key">` (key lowercased). */
function metaContent(metas: string[], key: string): string | undefined {
  for (const tag of metas) {
    const k = (attr(tag, "property") ?? attr(tag, "name"))?.toLowerCase();
    if (k !== key) continue;
    const c = attr(tag, "content");
    if (c != null) return decodeEntities(c).trim() || undefined;
  }
  return undefined;
}

function pageTitle(html: string): string | undefined {
  const m = /<title[^>]{0,256}>([^<]{0,2048})<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]).trim() || undefined : undefined;
}

function favicon(html: string, base: URL): string | undefined {
  for (const tag of tagsOf(html, "link")) {
    const rel = attr(tag, "rel")?.toLowerCase() ?? "";
    if (!/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) continue;
    const href = attr(tag, "href");
    if (href) {
      try {
        return new URL(decodeEntities(href), base).toString();
      } catch {
        /* malformed href — keep looking */
      }
    }
  }
  return new URL("/favicon.ico", base).toString();
}

const asCount = (s: string | undefined): number | undefined => {
  const n = s ? parseInt(s, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Resolve a page-declared resource URL and keep it only if it's a public host.
 *  The client fetches image/favicon URLs directly on hover, so an attacker page
 *  must not be able to aim them at `192.168.x.x`/internal hosts (SSRF-by-image). */
async function publicResource(raw: string | undefined, base: URL): Promise<string | undefined> {
  if (!raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return undefined;
  }
  try {
    await assertPublicUrl(u);
  } catch {
    return undefined;
  }
  return u.toString();
}

// ─── The route ────────────────────────────────────────────────────────────────

const fail = (): Response => Response.json({ ok: false }, { headers: { "cache-control": "no-store" } });

export async function GET(req: Request): Promise<Response> {
  let target: URL;
  try {
    target = new URL(new URL(req.url).searchParams.get("url") ?? "");
  } catch {
    return fail();
  }
  try {
    const { finalUrl, html } = await fetchPage(target);
    if (html === null) {
      return Response.json({ ok: true, url: finalUrl.toString() }, { headers: { "cache-control": "public, max-age=3600" } });
    }
    const head = headSlice(html);
    const metas = tagsOf(head, "meta");
    const rawImage = metaContent(metas, "og:image") ?? metaContent(metas, "og:image:url") ?? metaContent(metas, "twitter:image");
    const [image, icon] = await Promise.all([
      publicResource(rawImage, finalUrl),
      publicResource(favicon(head, finalUrl), finalUrl),
    ]);
    return Response.json(
      {
        ok: true,
        url: finalUrl.toString(),
        title: metaContent(metas, "og:title") ?? metaContent(metas, "twitter:title") ?? pageTitle(head),
        description: metaContent(metas, "og:description") ?? metaContent(metas, "twitter:description") ?? metaContent(metas, "description"),
        siteName: metaContent(metas, "og:site_name"),
        image,
        // Declared dimensions only matter when we actually kept the image.
        imageWidth: image ? asCount(metaContent(metas, "og:image:width")) : undefined,
        imageHeight: image ? asCount(metaContent(metas, "og:image:height")) : undefined,
        icon,
      },
      { headers: { "cache-control": "public, max-age=3600" } },
    );
  } catch {
    return fail();
  }
}
