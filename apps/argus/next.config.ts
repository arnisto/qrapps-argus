import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // The app never serves user images in v1; keep next/image strict.
  images: { remotePatterns: [] },
}

export default config
