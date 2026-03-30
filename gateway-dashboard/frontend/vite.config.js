import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../shared/frontend"),
    },
  },
  server: {
    port: 5178,
    proxy: { "/api": "http://localhost:8005" },
  },
});
