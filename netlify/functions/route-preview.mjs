const mapbox = 'https://api.mapbox.com';

export const config = {
  rateLimit: { action: 'rate_limit', windowLimit: 12, windowSize: 60, aggregateBy: ['ip'] },
};

function reply(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function mapboxRequest(path, token, params) {
  const url = new URL(path, mapbox);
  url.search = new URLSearchParams({ ...params, access_token: token });
  return fetch(url, { signal: AbortSignal.timeout(4500) });
}

async function locate(place, token) {
  const pin = place.match(/^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (pin) {
    const [lat, lng] = pin.slice(1).map(Number);
    return Math.abs(lat) <= 85 && Math.abs(lng) <= 180 ? [lng, lat] : undefined;
  }
  const response = await mapboxRequest('/search/geocode/v6/forward', token, {
    q: place,
    country: 'us',
    types: 'place,locality,postcode',
    autocomplete: 'false',
    limit: '1',
  });
  if (!response.ok) throw new Error('Geocoding unavailable');
  return (await response.json()).features[0]?.geometry.coordinates;
}

export default async function routePreview(request) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  }

  const body = await request.json().catch(() => null);
  const pickup = typeof body?.pickup === 'string' ? body.pickup.trim() : '';
  const dropoff = typeof body?.dropoff === 'string' ? body.dropoff.trim() : '';
  if (![pickup, dropoff].every(place => place.length > 0 && place.length <= 120 && !place.includes(';'))) {
    return reply({ error: 'Enter a pickup and drop-off city.' }, 400);
  }

  const googleKey = process.env.GOOGLE_MAPS_EMBED_KEY?.trim();
  if (googleKey) {
    const url = new URL('https://www.google.com/maps/embed/v1/directions');
    url.search = new URLSearchParams({
      key: googleKey, origin: pickup, destination: dropoff, mode: 'driving', units: 'imperial',
    });
    return reply({ googleEmbedUrl: url.href });
  }

  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) return reply({ error: 'Route preview is unavailable.' }, 503);

  try {
    const [start, end] = await Promise.all([locate(pickup, token), locate(dropoff, token)]);
    if (!start || !end || start.join(',') === end.join(',')) {
      return reply({ error: 'Enter two different locations.' }, 422);
    }

    const directions = await mapboxRequest(`/directions/v5/mapbox/driving/${start.join(',')};${end.join(',')}`, token, {
      alternatives: 'false',
      geometries: 'geojson',
      overview: 'simplified',
    });
    if (!directions.ok) throw new Error('Directions unavailable');
    const route = (await directions.json()).routes?.[0];
    if (!route || !Number.isFinite(route.distance)) return reply({ error: 'No driving route was found.' }, 422);

    const miles = Math.round(route.distance / 1609.344 * 10) / 10;
    const toLatLng = ([lng, lat]) => [lat, lng];
    const path = route.geometry?.coordinates?.map(toLatLng);
    return reply({ miles, pins: { pickup: toLatLng(start), dropoff: toLatLng(end) }, path });
  } catch {
    return reply({ error: 'Route preview is temporarily unavailable.' }, 503);
  }
}
