import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/marketplace/",
  plugins: [react()],
  server: {
    port: 5179,
    proxy: {
      "/api": {
        target: "http://localhost:8006",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
