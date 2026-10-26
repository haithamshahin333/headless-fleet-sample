import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // A self-contained server in .next/standalone for the container image (see Dockerfile).
  output: "standalone",
};
export default config;
