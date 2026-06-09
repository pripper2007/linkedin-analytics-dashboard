// Build script for the Chrome extension.
//
// What it does:
//   1. Wipes extension/dist/.
//   2. Copies static assets (manifest.json, options.html) from public/ to dist/.
//   3. Bundles each TypeScript entry point with esbuild → dist/<name>.js.
//
// Outputs are what Chrome loads via "Load unpacked" → extension/dist/.
//
// Run: node extension/build.mjs            (one-shot)
//      node extension/build.mjs --watch    (rebuild on change)

import { rmSync, mkdirSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SRC = resolve(__dirname, 'src');
const PUBLIC = resolve(__dirname, 'public');
const DIST = resolve(__dirname, 'dist');

// Each extension entry point gets its own bundle. We use IIFE format so the
// output is a plain script — MV3 content scripts and classic service workers
// don't natively resolve bare module imports.
const entries = [
  'background',
  'content-script',
  'injected-interceptor',
  'options',
];

const commonOptions = {
  bundle: true,
  format: 'iife',
  target: ['chrome120'], // modern Chrome; loose enough for any MV3 install
  logLevel: 'info',
  sourcemap: process.env.NODE_ENV !== 'production' ? 'inline' : false,
  minify: process.env.NODE_ENV === 'production',
};

function prepareDist() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  // Copy static assets verbatim.
  cpSync(PUBLIC, DIST, { recursive: true });
}

async function buildOnce() {
  prepareDist();
  await Promise.all(
    entries.map((name) =>
      build({
        ...commonOptions,
        entryPoints: [resolve(SRC, `${name}.ts`)],
        outfile: resolve(DIST, `${name}.js`),
      }),
    ),
  );
  console.log('\n✓ extension built to', DIST);
}

async function buildWatch() {
  prepareDist();
  const ctxs = await Promise.all(
    entries.map((name) =>
      context({
        ...commonOptions,
        entryPoints: [resolve(SRC, `${name}.ts`)],
        outfile: resolve(DIST, `${name}.js`),
      }),
    ),
  );
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('\n⏳ watching for changes…');
}

const watch = process.argv.includes('--watch');
(watch ? buildWatch() : buildOnce()).catch((err) => {
  console.error(err);
  process.exit(1);
});
