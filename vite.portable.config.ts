import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig(({ mode }) => {
  const values = loadEnv(mode, process.cwd(), "");
  return {
    root: "frontend",
    publicDir: "../public",
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(".") } },
    build: { outDir: "../dist-portable", emptyOutDir: true },
    server: {
      host: "0.0.0.0",
      port: 3000,
      proxy: {
        "/api": {
          target: values.IOT_API_URL || "http://localhost:8000",
          changeOrigin: true,
          headers: {
            Authorization:
              "Bearer " + (process.env.API_TOKEN || values.API_TOKEN || ""),
          },
        },
      },
    },
  };
});
