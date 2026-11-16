export const config = {
  rateLimit: { action: 'rate_limit', windowLimit: 40, windowSize: 60, aggregateBy: ['ip'] },
};

const headers = { 'Cache-Control': 'no-store' };

export default async function addressSuggestions(request) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  }

  const body = await request.json().catch(() => null);
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (query.length < 5 || query.length > 120 || !/^\d+\w*[-\d]*\s+\S/.test(query)) {
    return Response.json([], { status: 400, headers });
  }

  const apiKey = process.env.GEOAPIFY_ROUTING_KEY?.trim();
  if (!apiKey) {
    console.error('Geoapify key is missing from this deploy context.');
    return Response.json([], { status: 503, headers });
  }

  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  url.search = new URLSearchParams({
    text: query, filter: 'countrycode:us', format: 'json', limit: '5', apiKey,
  });

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!response.ok) {
      console.error('Geoapify autocomplete returned HTTP', response.status);
      return Response.json([], { status: 503, headers });
    }

    const { results } = await response.json();
    const addresses = new Map();
    for (const address of results ?? []) {
      const { country_code, formatted, housenumber, street, lat, lon } = address;
      if (country_code !== 'us' || !housenumber || !street ||
          typeof formatted !== 'string' || !formatted || formatted.length > 120 ||
          !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      addresses.set(formatted, { label: formatted, point: [lat, lon] });
    }
    return Response.json([...addresses.values()], { headers });
  } catch (error) {
    console.error('Geoapify autocomplete request failed:', error.name);
    return Response.json([], { status: 503, headers });
  }
}
