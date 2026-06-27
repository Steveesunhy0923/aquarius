import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Aquarius — WYSIWYG math notes",
  description:
    "A math-first note editor. Edit visually; export clean, typeset LaTeX. Local-first, offline-capable.",
  applicationName: "Aquarius",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // PWA / iPad: lock zoom for a native-feel editor surface.
  maximumScale: 1,
  themeColor: "#4f46e5",
};

// Apply the saved theme before first paint (no flash of the wrong palette).
const THEME_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem('aquarius.settings.v1')||'{}');var t=s.theme;var c=document.documentElement.classList;c.remove('theme-light','theme-dark');if(t==='light')c.add('theme-light');else if(t==='dark')c.add('theme-dark');}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
