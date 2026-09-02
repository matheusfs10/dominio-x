import type { NextConfig } from "next";

/**
 * The browser only ever talks to the web origin: /api/v1/* is proxied at runtime by
 * app/api/v1/[...path]/route.ts to the Core API (API_INTERNAL_URL, private network in production),
 * which keeps the session cookie first-party and lets the API's Origin-based CSRF check work.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@dominio-x/contracts"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
