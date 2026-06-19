/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Allow overriding the build directory per-process so two dev servers
  // (e.g. a stale one we can't kill + our fresh one) don't fight over .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    typedRoutes: false,
  },
  // Proxy `/be/*` to Fastify so the browser only ever talks to the dashboard
  // origin. Set-Cookie passes through with the dashboard's origin scope —
  // that's the whole reason we proxy instead of CORS-ing the API directly:
  // cookies just work, no cross-origin headaches.
  //
  // Internal next.js API routes live under /api/* and are NOT rewritten.
  async rewrites() {
    const apiBase =
      process.env.INTERNAL_API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      'http://localhost:4000';
    return [
      { source: '/be/:path*', destination: `${apiBase}/:path*` },
    ];
  },
};

module.exports = nextConfig;
