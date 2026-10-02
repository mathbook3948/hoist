import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const apiOrigin = process.env.HOIST_API_ORIGIN || "http://127.0.0.1:3000";
const webOrigin = "http://127.0.0.1:5173";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  publicDir: false,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiOrigin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq, req) => {
            // Translate only our development UI's Origin; foreign origins remain rejected.
            if (req.headers.origin === webOrigin)
              proxyReq.setHeader("Origin", apiOrigin);
          });
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.tsx"],
    restoreMocks: true,
  },
});
