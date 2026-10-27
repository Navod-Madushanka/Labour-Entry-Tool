import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Built into the backend package so `python -m app.main` serves it (PLAN.md §3).
export default defineConfig({
  plugins: [react()],
  base: "/app/",
  build: { outDir: "../backend/app/static/app", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
