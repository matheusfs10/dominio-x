import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  // Inline workspace packages; keep every npm dependency (incl. native modules) external.
  noExternal: [/^@dominio-x\//],
  external: [/^(?!@dominio-x\/)[^./]/],
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
});
