import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
  },
  format: ["esm"],
  target: "node24",
  platform: "node",
  outDir: "dist",
  clean: false,
  splitting: false,
  sourcemap: true,
  external: ["node:sqlite"],
  esbuildOptions(options) {
    options.packages = "external";
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
});
