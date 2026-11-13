import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@neuralayer/core", "@neuralayer/config"],
};

export default nextConfig;
