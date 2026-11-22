import * as L from 'leaflet';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl, setWorkerCount } from 'maplibre-gl';

setWorkerUrl('/assets/maplibre-gl-worker.mjs');
setWorkerCount(2);
export { L };
export function addBasemap(map) {
  map.setMinZoom(1);
  return maplibreGL({
    style: 'https://tiles.openfreemap.org/styles/positron',
    attribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> · © <a href="https://openmaptiles.org/">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
}
