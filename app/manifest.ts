import type { MetadataRoute } from "next";

// Emitted as /manifest.webmanifest; Next adds the <link rel="manifest"> itself.
// `force-static` because the static export (CAP_STATIC) cannot contain a route
// that is computed per request.
export const dynamic = "force-static";

/**
 * Web app manifest — what makes Aquarius installable to a Dock / home screen
 * and opens it in its own window. The offline half of "installable" is the
 * service worker (public/sw.js); the two are independent, but an installed app
 * that only opens online is not much of an app.
 *
 * Colours mirror app/globals.css (`--accent`, light `--background`); a
 * manifest cannot follow the dark theme, so these are the light values. Icons
 * come from scripts/generate-icons.mjs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aquarius — WYSIWYG math notes",
    short_name: "Aquarius",
    description:
      "A math-first note editor. Edit visually; export clean, typeset LaTeX. Local-first, offline-capable.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fbfbfd",
    theme_color: "#5b5bd6",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
