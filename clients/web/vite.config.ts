import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: process.env.VITE_SERVER_URL ?? "http://localhost:8000",
        changeOrigin: true,
        secure: false,
      },
      "/identity": {
        target: process.env.VITE_SERVER_URL ?? "http://localhost:8000",
        changeOrigin: true,
        secure: false,
      },
      "/notifications": {
        target: process.env.VITE_SERVER_URL ?? "http://localhost:8000",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  // Needed for Tauri — allow tauri:// and asset:// protocols
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
});
