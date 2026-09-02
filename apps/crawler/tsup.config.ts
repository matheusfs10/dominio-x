import { defineConfig } from "tsup";

export default defineConfig({
  entry: { crawler: "src/crawler.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^@dominio-x\//],
  external: [/^(?!@dominio-x\/)[^./]/],
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
});
