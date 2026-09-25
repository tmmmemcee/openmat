// Production bundle: one file per entry point, workspace code (@openmat/core) included.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts", "src/migrate.ts", "src/cli/director-link.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  // Some dependencies use require(); give ESM output a working one.
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});
console.log("Built dist/");
