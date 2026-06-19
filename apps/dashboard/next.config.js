/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
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
