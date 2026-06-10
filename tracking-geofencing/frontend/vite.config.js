import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ base: "/tracking/", plugins: [react()], server: { port: 5175, proxy: { "/api": "http://localhost:8002" } } });
