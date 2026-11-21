import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname),
  base: "/",
  plugins: [preact()],
  build: {
    outDir: resolve(__dirname, "../dist/ui"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
