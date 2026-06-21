// esbuild.config.mjs — bundles the four entrypoints and copies static assets to /dist.
import { build, context } from "esbuild";
import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const watch = process.argv.includes("--watch");
const prod = process.env.NODE_ENV === "production";

/** Recursively copy every .html under src/ into dist/ (flattened per directory). */
function copyAssets() {
  mkdirSync("dist", { recursive: true });
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (extname(p) === ".html") cpSync(p, join("dist", name));
    }
  };
  walk("src");
  // icons referenced by manifest
  try {
    cpSync("icons", join("dist", "icons"), { recursive: true });
  } catch {
    /* icons optional */
  }
}

const options = {
  entryPoints: {
    background: "src/background/index.ts",
    dashboard: "src/dashboard/dashboard.ts",
    popup: "src/popup/popup.ts",
    offscreen: "src/offscreen/offscreen.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "chrome116",
  sourcemap: !prod,
  minify: prod,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  copyAssets();
  console.log("[esbuild] watching…");
} else {
  await build(options);
  copyAssets();
  console.log("[esbuild] build complete → dist/");
}
