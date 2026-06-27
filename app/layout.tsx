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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
