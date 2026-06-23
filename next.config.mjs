/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The editor is entirely client-side / local-first. Server components are used
  // only for the shell. Nothing here should require a Node runtime by default.
  experimental: {
    optimizePackageImports: ["katex"],
  },
};

export default nextConfig;
