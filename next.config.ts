import type { NextConfig } from "next";

/**
 * next dev serves /_next/* only to the origin it was started for. Opening the
 * app by LAN address — from a phone, or from another machine — gets a 403 on
 * every chunk, and a page whose JavaScript never arrives looks exactly like a
 * page whose buttons do nothing. List those hosts in DEV_ORIGINS.
 *
 * Development only. next start does not consult this.
 */
const devOrigins = (process.env.DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const config: NextConfig = {
  reactStrictMode: true,
  // Ships a server that carries only the files it actually imports, so the
  // deployed image does not include node_modules.
  output: "standalone",
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
};

export default config;
