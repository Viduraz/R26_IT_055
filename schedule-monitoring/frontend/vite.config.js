import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ base: "/schedule/", plugins: [react()], server: { port: 5177, proxy: { "/api": "http://localhost:8004" } } });
