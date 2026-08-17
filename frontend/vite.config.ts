import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite dev server proxies /api to the agent backend so the frontend can use
// relative URLs in dev; in production set VITE_AGENT_API_URL to the deployed API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_AGENT_API_URL || "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
