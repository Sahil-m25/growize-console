import { withReticle } from '@reticlehq/next';
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /* the local test build (npm run build:local) keeps its output apart from the real build */
  distDir: process.env.GZ_LOCAL_BUILD === "1" ? ".next-local" : ".next",
  typescript: { ignoreBuildErrors: false },
};
export default withReticle(nextConfig);
