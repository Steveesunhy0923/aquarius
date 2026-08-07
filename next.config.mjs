/** @type {import('next').NextConfig} */

// CAP_STATIC=1 → `output: "export"`: the whole app becomes static files in
// out/ for the Capacitor iOS shell (and future desktop shells). API routes
// cannot exist in an export — scripts/build-static.mjs parks app/api during
// the build, and clients reach the hosted ones via NEXT_PUBLIC_API_ORIGIN
// (lib/api.ts) or degrade gracefully.
const staticExport = !!process.env.CAP_STATIC;

const nextConfig = {
  reactStrictMode: true,
  // The editor is entirely client-side / local-first. Server components are used
  // only for the shell. Nothing here should require a Node runtime by default.
  ...(staticExport ? { output: "export", trailingSlash: true } : {}),
  experimental: {
    optimizePackageImports: ["katex"],
  },
};

export default nextConfig;
