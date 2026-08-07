"use client";

import { Icon } from "@/components/Icon";
import { placeCard, useHoverCard } from "@/components/ui/hovercard";
import { apiUrl } from "@/lib/api";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * ExternalLink — an ordinary `[text](https://…)` link in prose. Clicking opens
 * a new tab; hovering shows a Google-Docs-style preview card of the target
 * page, built from its Open Graph metadata (fetched via /api/unfurl — browsers
 * can't read cross-origin pages themselves). The card's orientation follows
 * the page's cover image: a landscape cover gets a wide banner card, a
 * portrait cover a tall card, and a square/missing image a compact row. When
 * unfurling is unavailable (static builds, offline, sites that block bots)
 * the card degrades to favicon-less domain + URL.
 */

interface Unfurl {
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  imgW?: number;
  imgH?: number;
  icon?: string;
}

interface UnfurlResponse {
  ok: boolean;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  icon?: string;
}

// null = no metadata available (show the fallback card).
type Fetched = Unfurl | null;

const cache = new Map<string, { at: number; data: Fetched }>();
const TTL = 10 * 60_000;
const FAIL_TTL = 30_000; // failures retry soon (transient network, cold server)

/** Load an image just to learn its natural size; null on error/timeout. */
function measureImage(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    let settle = (v: { w: number; h: number } | null) => {
      settle = () => {};
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => settle(null), 4_000);
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => settle(img.naturalWidth > 0 && img.naturalHeight > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null);
    img.onerror = () => settle(null);
    img.src = src;
  });
}

async function fetchUnfurl(href: string): Promise<Fetched> {
  const hit = cache.get(href);
  if (hit && Date.now() - hit.at < (hit.data ? TTL : FAIL_TTL)) return hit.data;
  let data: Fetched = null;
  try {
    const res = await fetch(apiUrl(`/api/unfurl?url=${encodeURIComponent(href)}`));
    const j = res.ok ? ((await res.json()) as UnfurlResponse) : null;
    if (j?.ok) {
      data = {
        title: j.title,
        description: j.description,
        siteName: j.siteName,
        image: j.image,
        imgW: j.imageWidth,
        imgH: j.imageHeight,
        icon: j.icon,
      };
      // Orientation needs the cover's aspect ratio; measure it when the page
      // didn't declare og:image:width/height.
      if (data.image && !(data.imgW && data.imgH)) {
        const dims = await measureImage(data.image);
        if (dims) {
          data.imgW = dims.w;
          data.imgH = dims.h;
        } else {
          data.image = undefined; // unloadable image — card falls back to compact
        }
      }
    }
  } catch {
    data = null;
  }
  cache.set(href, { at: Date.now(), data });
  return data;
}

const hostOf = (href: string): string => {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
};

export function ExternalLink({ href, text }: { href: string; text: string }) {
  // undefined = not fetched yet / loading.
  const [meta, setMeta] = useState<Fetched | undefined>(undefined);
  const { anchorRef, rect, armOpen, armClose, cancel } = useHoverCard(() => void fetchUnfurl(href).then(setMeta));
  // React reuses this instance when only the href segment changes (index keys)
  // — never show the previous target's fetched content.
  useEffect(() => {
    setMeta(undefined);
    cancel();
  }, [href, cancel]);
  // Previews only for web pages; mailto:/tel:/… stay plain links.
  const previewable = /^https?:\/\//i.test(href);

  return (
    <>
      <a
        ref={anchorRef}
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          e.stopPropagation(); // never trigger the paragraph's click-to-edit
          cancel();
        }}
        onMouseEnter={previewable ? armOpen : undefined}
        onMouseLeave={previewable ? armClose : undefined}
        className="text-accent underline"
      >
        {text}
      </a>
      {/* Portal: links live inside <p>/<button> where a <div> card would be
          invalid DOM (hydration warnings); the card is fixed-positioned anyway. */}
      {previewable && rect && createPortal(
        <ExternalCard href={href} meta={meta} rect={rect} onEnter={armOpen} onLeave={armClose} onOpen={cancel} />,
        document.body,
      )}
    </>
  );
}

/** The favicon, degrading to the drawn link glyph when absent or unloadable. */
function Favicon({ icon, size = 16 }: { icon?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!icon || failed) return <Icon name="link" size={size} className="shrink-0 text-muted" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={icon} alt="" width={size} height={size} referrerPolicy="no-referrer" className="shrink-0 rounded-sm" onError={() => setFailed(true)} />;
}

function ExternalCard({ href, meta, rect, onEnter, onLeave, onOpen }: {
  href: string;
  meta: Fetched | undefined;
  rect: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: () => void;
}) {
  const domain = hostOf(href);
  const aspect = meta?.image && meta.imgW && meta.imgH ? meta.imgW / meta.imgH : null;
  // The card takes the cover image's orientation: wide covers lay the card
  // out horizontally (banner on top of a wide card), portrait covers make it
  // a tall card; square or absent covers get a compact row.
  const shape: "wide" | "tall" | "compact" = aspect === null ? "compact" : aspect >= 1.15 ? "wide" : aspect <= 0.9 ? "tall" : "compact";
  const width = shape === "wide" ? 420 : shape === "tall" ? 264 : 360;

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
        window.open(href, "_blank", "noopener,noreferrer");
      }}
      className="print-hide fixed z-80 cursor-pointer overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
      // Placement uses the max card footprint (420×420) so the side/position is
      // stable as the card grows from the compact loading state to its final shape.
      style={{ width, ...placeCard(rect, 420, 420) }}
    >
      {meta === undefined ? (
        <p className="px-4 py-5 text-center text-xs text-muted">Loading preview…</p>
      ) : (
        <>
          {meta?.image && shape !== "compact" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={meta.image} alt="" referrerPolicy="no-referrer" className={`w-full border-b border-border-soft object-cover ${shape === "wide" ? "h-52" : "h-72"}`} />
          )}
          <div className="flex items-start gap-2.5 px-3.5 py-2.5">
            {shape === "compact" &&
              (meta?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={meta.image} alt="" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-md border border-border-soft object-cover" />
              ) : (
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-border-soft bg-background">
                  <Favicon icon={meta?.icon} size={18} />
                </span>
              ))}
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-semibold">{meta?.title || domain}</p>
              {meta?.description ? (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">{meta.description}</p>
              ) : (
                <p className="mt-0.5 truncate text-xs text-muted">{href}</p>
              )}
            </div>
          </div>
        </>
      )}
      <div className="flex items-center gap-1.5 border-t border-border-soft px-3.5 py-1.5 text-[10.5px] uppercase tracking-wide text-faint">
        {shape !== "compact" && <Favicon icon={meta === undefined ? undefined : meta?.icon} size={13} />}
        <span className="min-w-0 truncate">{meta?.siteName || domain}</span>
        <span className="ml-auto shrink-0">Click to open</span>
      </div>
    </div>
  );
}
