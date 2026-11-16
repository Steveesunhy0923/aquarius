"use client";

import { useEffect } from "react";

import { reportError } from "@/lib/monitoring";

/**
 * Last-resort boundary: catches a throw in the ROOT LAYOUT or its providers,
 * which app/error.tsx cannot (it lives inside that layout).
 *
 * When this renders it REPLACES the root layout, so it must supply its own
 * <html> and <body>, and nothing the layout set up can be assumed: not the
 * stylesheet, not the theme class, not the providers. Hence inline styles and
 * no imports from the component kit — the thing that broke may be exactly
 * what those depend on. Colors follow the system scheme via `light-dark()`,
 * since the saved theme preference is applied by a script in the layout that
 * did not run.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { area: "render.root", extra: { digest: error.digest, path: window.location.pathname } });
  }, [error]);

  const button: React.CSSProperties = {
    font: "inherit",
    fontSize: 14,
    padding: "8px 16px",
    borderRadius: 8,
    border: "1px solid light-dark(#ebebf0, #2a2a35)",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    textDecoration: "none",
  };

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 16,
          colorScheme: "light dark",
          background: "light-dark(#fbfbfd, #0e0e12)",
          color: "light-dark(#17171c, #ededf2)",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <div role="alert" style={{ width: "100%", maxWidth: 448 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Aquarius couldn&rsquo;t start</h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.6, opacity: 0.7 }}>
            Something failed while loading the app. Your notes are stored on this device and were not
            touched. Reloading usually fixes it.
          </p>
          <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              onClick={() => window.location.reload()}
              style={{ ...button, border: "none", background: "light-dark(#5b5bd6, #818cf8)", color: "#fff", fontWeight: 500 }}
            >
              Reload
            </button>
            <button onClick={reset} style={button}>Try again</button>
          </div>
          {error.message && (
            <pre
              style={{
                marginTop: 24,
                padding: 12,
                maxHeight: 192,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 12,
                borderRadius: 8,
                border: "1px solid light-dark(#ebebf0, #2a2a35)",
              }}
            >
              {error.message}
              {error.digest ? `\ndigest ${error.digest}` : ""}
            </pre>
          )}
        </div>
      </body>
    </html>
  );
}
