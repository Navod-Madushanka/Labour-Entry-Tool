import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Built into the backend package so `python -m app.main` serves it (PLAN.md §3).
// React code, run by Preact (preact/compat): the same components in a much smaller bundle.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom/client": "preact/compat/client",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
  },
  base: "/app/",
  build: { outDir: "../backend/app/static/app", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
