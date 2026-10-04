import { withReticle } from '@reticlehq/next';
import { nextHeaderRules } from './security-headers.mjs';
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /* R4 (Catalyst AppSail): a self-contained server in <distDir>/standalone — what console/Dockerfile ships.
     `next dev` is unaffected; `next start` still works but prints a note that standalone is the intended server. */
  output: "standalone",
  /* the local test build (npm run build:local) keeps its output apart from the real build */
  distDir: process.env.GZ_LOCAL_BUILD === "1" ? ".next-local" : ".next",
  typescript: { ignoreBuildErrors: false },
  /* M18-S15-H1: security headers on every response; a page's CSP (with its nonce) is set in src/middleware.ts */
  async headers() { return nextHeaderRules(); },
};
export default withReticle(nextConfig);
