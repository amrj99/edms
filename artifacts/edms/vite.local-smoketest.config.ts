// Local smoke-test only — NOT used in production builds or Docker images.
// Identical to vite.config.ts, except the /api proxy target points at the
// locally published Docker API port (8088) instead of the default 8080,
// which is occupied by an unrelated process on this machine.
import { mergeConfig, defineConfig } from "vite";
import base from "./vite.config";

export default defineConfig(async (env) => {
  const baseConfig = await (typeof base === "function" ? base(env) : base);
  return mergeConfig(baseConfig, {
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:8088",
          ws: true,
          changeOrigin: true,
        },
      },
    },
  });
});
