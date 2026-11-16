export const config = {
  rateLimit: { action: 'rate_limit', windowLimit: 12, windowSize: 60, aggregateBy: ['ip'] },
};

function reply(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function coordinates(value) {
  if (typeof value !== 'string' || !/^-?\d{1,3}(?:\.\d{1,15})?,\s*-?\d{1,3}(?:\.\d{1,15})?$/.test(value)) return;
  const [lat, lng] = value.split(',').map(Number);
  if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
}

export default async function routePreview(request) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  }

  const body = await request.json().catch(() => null);
  const pickup = coordinates(body?.pickup);
  const dropoff = coordinates(body?.dropoff);
  if (!pickup || !dropoff || pickup.join(',') === dropoff.join(',')) {
    return reply({ error: 'Choose two different locations.' }, 400);
  }

  const apiKey = process.env.GEOAPIFY_ROUTING_KEY?.trim();
  if (!apiKey) return reply({ error: 'Driving route preview is unavailable.' }, 503);

  const url = new URL('https://api.geoapify.com/v1/routing');
  url.search = new URLSearchParams({
    waypoints: [pickup, dropoff].join('|'),
    mode: 'drive',
    units: 'metric',
    apiKey,
  });

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Directions unavailable');

    const feature = (await response.json()).features?.[0];
    const { distance, time } = feature?.properties ?? {};
    const geometry = feature?.geometry;
    if (!Number.isFinite(distance) || !Number.isFinite(time) ||
        geometry?.type !== 'MultiLineString' || !geometry.coordinates?.length) {
      return reply({ error: 'No driving route was found.' }, 422);
    }

    const path = geometry.coordinates.map(line => line.map(([lng, lat]) => [lat, lng]));
    const miles = Math.round(distance / 1609.344 * 10) / 10;
    const minutes = Math.max(1, Math.round(time / 60));
    return reply({ miles, minutes, path });
  } catch {
    return reply({ error: 'Driving route preview is temporarily unavailable.' }, 503);
  }
}
