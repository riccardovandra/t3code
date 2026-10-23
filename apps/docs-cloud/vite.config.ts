import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

// Builds the SPA into dist/, which wrangler serves as static assets.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
