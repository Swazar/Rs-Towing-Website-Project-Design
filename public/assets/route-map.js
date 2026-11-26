const names = { pickup: 'Pickup', dropoff: 'Drop-off' };
const blue = '#1761bf';
let leaflet;
let mapTools;

export function loadLeaflet() {
  if (leaflet) return leaflet;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = '/assets/map-tools.css';
  const css = new Promise((resolve, reject) => { style.onload = resolve; style.onerror = reject; document.head.append(style); });
  // Both the standalone module and the admin bundle load this generated asset in the browser.
  const bundle = new URL('./map-tools.bundle.js', import.meta.url).href;
  leaflet = Promise.all([css, import(bundle)]).then(([, tools]) => {
    mapTools = tools; window.L = tools.L; return tools.L;
  }).catch(() => {
    style.remove();
    leaflet = undefined;
    throw new Error('Map tools are unavailable');
  });
  return leaflet;
}

export function addBasemap(map) { return mapTools.addBasemap(map); }

export function drivingDirectionsUrl(origin, destination) {
  const url = new URL('https://www.google.com/maps/dir/');
  url.search = new URLSearchParams({ api: '1', origin, destination, travelmode: 'driving' }).toString();
  return url.href;
}

export async function renderRoadRoute(element, route, pins) {
  const L = await loadLeaflet();
  if (!element.isConnected) return () => {};
  const map = L.map(element, { scrollWheelZoom: false });
  addBasemap(map);
  const layers = L.featureGroup().addTo(map);
  L.polyline(route.path, { color: blue, weight: 5 }).addTo(layers);
  for (const [name, pin] of Object.entries(pins)) {
    L.circleMarker(pin, { radius: 7, color: blue, fillColor: name === 'pickup' ? 'white' : blue, fillOpacity: 1 })
      .bindTooltip(names[name], { permanent: true, direction: 'top' }).addTo(layers);
  }
  map.fitBounds(layers.getBounds(), { padding: [25, 25], maxZoom: 15, animate: false });
  return () => map.remove();
}

export function addRoutePreview(form, locations, validateRoute) {
  const preview = form.querySelector('.route-preview');
  const panel = preview.querySelector('.map-panel');
  const mapButton = preview.querySelector('.route-check');
  const status = preview.querySelector('.route-status');
  const link = preview.querySelector('.route-link');
  const locateButton = form.querySelector('.map-location');
  let pending;
  let map;
  let layers;
  let route;
  const pointFor = name => locations.pointFor(form.elements[name]);

  function showDirectionsLink() {
    const origin = pointFor('pickup')?.join(',');
    const destination = pointFor('dropoff')?.join(',');
    if (!origin || !destination) return;
    link.href = drivingDirectionsUrl(origin, destination);
    link.hidden = false;
  }

  function drawRoute(fit = false) {
    if (!map) return;
    layers.clearLayers();
    const pins = Object.fromEntries(Object.keys(names).map(name => [name, pointFor(name)]));
    const points = Object.values(pins).filter(Boolean);

    if (route?.path?.length) {
      window.L.polyline(route.path, { color: blue, weight: 5 }).addTo(layers);
    }

    for (const [name, pin] of Object.entries(pins)) {
      if (!pin) continue;
      window.L.circleMarker(pin, { radius: 7, color: blue, fillColor: name === 'pickup' ? 'white' : blue, fillOpacity: 1 })
        .bindTooltip(names[name], { permanent: true, direction: 'top' }).addTo(layers);
    }
    if (fit && points.length === 2) map.fitBounds(layers.getBounds(), { padding: [29, 30], maxZoom: 15, animate: false });
    else if (fit && points.length === 1) map.setView(points[0], 13, { animate: false });
  }

  async function openMap(fit = false, signal) {
    const L = await loadLeaflet();
    if (signal?.aborted) return;
    panel.hidden = false;
    if (!map) {
      map = L.map(panel.querySelector('.route-map'), { scrollWheelZoom: false }).setView([35.2271, -80.8431], 11);
      addBasemap(map);
      layers = L.featureGroup().addTo(map);
    }
    map.invalidateSize({ pan: false });
    drawRoute(fit);
  }

  function clearRoute() {
    pending?.abort();
    pending = undefined;
    route = undefined;
    panel.hidden = true;
    link.hidden = true;
    status.textContent = '';
    drawRoute();
  }

  preview.hidden = false;
  form.elements.pickup.addEventListener('input', clearRoute);
  form.elements.dropoff.addEventListener('input', clearRoute);
  form.elements.pickup.addEventListener('routechange', clearRoute);
  locateButton.hidden = !navigator.geolocation;
  locateButton.addEventListener('click', async () => {
    const initialPickup = form.elements.pickup.value;
    locateButton.disabled = true;
    status.textContent = 'Checking your current location…';
    try {
      const { coords } = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
      });
      const accepted = await locations.useDevicePickup(coords.latitude, coords.longitude, initialPickup);
      if (accepted === undefined) return;
      status.textContent = accepted
        ? 'Pickup is set to your current location.'
        : 'This form accepts U.S. locations only. Enter a U.S. pickup city to continue.';
    } catch {
      if (form.elements.pickup.value === initialPickup) status.textContent = 'Your location could not be verified. Enter the pickup city and state.';
    } finally {
      locateButton.disabled = false;
    }
  });

  mapButton.addEventListener('click', async () => {
    clearRoute();
    const invalid = validateRoute();
    if (invalid) {
      invalid.focus();
      return;
    }
    const pickup = pointFor('pickup')?.join(',');
    const dropoff = pointFor('dropoff')?.join(',');
    if (!pickup || !dropoff) {
      status.textContent = 'A route preview needs two matched locations. You can send your quote with a manual or undecided location.';
      return;
    }
    showDirectionsLink();
    const request = new AbortController();
    pending = request;

    status.textContent = 'Looking up the driving route…';

    try {
      const response = await fetch('/.netlify/functions/route-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickup, dropoff }),
        signal: request.signal,
      });
      if (!response.ok) throw new Error('Route unavailable');
      const result = await response.json();
      if (pending !== request) return;
      route = result;
      await openMap(true, request.signal);
      if (pending !== request) return;
      const miles = route.miles.toLocaleString('en-US');
      const hours = Math.floor(route.minutes / 60);
      const minutes = route.minutes % 60;
      const duration = hours ? `${hours} hr ${minutes} min` : `${minutes} min`;
      const streetOnly = Object.keys(names).some(name => locations.isStreetOnly(form.elements[name]));
      const note = streetOnly ? 'Estimate uses the selected street without a house number.' : 'Driving estimate. RS will confirm pickup availability.';
      status.textContent = `About ${miles} driving miles · ${duration}. ${note}`;
    } catch {
      if (pending !== request) return;
      try {
        await openMap(true, request.signal);
      } catch {
        if (pending === request) status.textContent = 'The inline map could not load. Open Google Maps for driving distance or continue with your quote.';
        return;
      }
      if (pending !== request) return;

      status.textContent = 'Driving route unavailable. Open Google Maps for road mileage or continue with your quote.';
    } finally {
      if (pending === request) pending = undefined;
    }
  });
}
