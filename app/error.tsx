"use client";

import { useEffect, useState } from "react";

import { BTN, BTN_PRIMARY } from "@/components/ui/primitives";
import { reportError } from "@/lib/monitoring";

/**
 * Route error boundary — what a visitor sees when a page throws while
 * rendering, instead of a blank white screen with the reason buried in a
 * console they will never open.
 *
 * It renders INSIDE the root layout, so the theme, providers and toasts are
 * still up; a failure in the layout itself is caught one level out, by
 * global-error.tsx.
 *
 * "Try again" re-renders the route in place. That is right for a transient
 * failure and useless for a deterministic one (a note whose tree the renderer
 * cannot handle throws again immediately) — hence the second way out, back to
 * the library, which is a hard navigation on purpose: it discards whatever
 * client state the crash left behind.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    reportError(error, { area: "render", extra: { digest: error.digest, path: window.location.pathname } });
  }, [error]);

  const details = [error.name && error.name !== "Error" ? `${error.name}: ${error.message}` : error.message, error.digest && `digest ${error.digest}`]
    .filter(Boolean)
    .join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${details}\n\n${error.stack ?? ""}\n\n${window.location.pathname}\n${navigator.userAgent}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the details are on screen to select by hand.
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10 text-foreground">
      <div role="alert" className="w-full max-w-md">
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This page hit an error and couldn&rsquo;t continue. Your notes are saved on this device as you
          work, so anything already saved is still there.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={reset} className={BTN_PRIMARY}>Try again</button>
          {/* A plain <a>, not <Link>: a full reload, so no crashed state survives. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className={BTN}>Back to library</a>
        </div>

        <details className="mt-6 text-sm">
          <summary className="cursor-pointer select-none text-muted hover:text-foreground">Error details</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-control border border-border bg-surface p-3 text-xs">{details || "No message"}</pre>
          <button onClick={copy} className="mt-2 text-xs text-muted hover:text-accent">
            {copied ? "Copied" : "Copy details"}
          </button>
        </details>
      </div>
    </main>
  );
}
