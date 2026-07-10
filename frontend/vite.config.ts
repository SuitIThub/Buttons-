import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Im Dev-Modus werden API und WebSocket an das Backend (Port 8080) weitergeleitet.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
  build: {
    outDir: "dist",
  },
});
