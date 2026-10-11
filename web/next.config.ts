import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image builds a self-contained server bundle; `npm start` uses the regular output.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  reactStrictMode: true,
  // postgres.js opens sockets; keep it out of the server bundle.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
