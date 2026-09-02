import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    migrate: "src/migrate.ts",
    seed: "src/seed.ts",
    "admin-create": "src/admin-create.ts",
  },
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
