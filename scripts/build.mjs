import { build } from 'esbuild';
import { readFile, writeFile, copyFile, cp } from 'node:fs/promises';
import { emitSiteDiscovery } from './site-discovery.mjs';

await build({
  entryPoints: ['src/admin/index.js'],
  outfile: 'public/assets/admin.bundle.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'eof',
});

await build({
  entryPoints: ['src/map-tools.js'], outfile: 'public/assets/map-tools.bundle.js', bundle: true,
  format: 'esm', platform: 'browser', target: ['es2022'], minify: true, legalComments: 'eof',
});
const leafletCSS = await readFile('node_modules/leaflet/dist/leaflet.css', 'utf8');
const maplibreCSS = await readFile('node_modules/maplibre-gl/dist/maplibre-gl.css', 'utf8');
await writeFile('public/assets/map-tools.css', leafletCSS.replaceAll('images/', 'map-images/') + '\n' + maplibreCSS);
await copyFile('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', 'public/assets/maplibre-gl-worker.mjs');
await cp('node_modules/leaflet/dist/images', 'public/assets/map-images', { recursive: true });
await emitSiteDiscovery();
