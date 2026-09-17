import { defineConfig } from "vite";
export default defineConfig({
  root: "apps/ui",
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4318" },
  },
  build: { outDir: "../../dist/ui", emptyOutDir: true },
});
