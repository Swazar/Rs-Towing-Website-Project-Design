export const config = {
  rateLimit: { action: 'rate_limit', windowLimit: 40, windowSize: 60, aggregateBy: ['ip'] },
};

const headers = { 'Cache-Control': 'no-store' };

async function findStreets(text, apiKey, signal) {
  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  url.search = new URLSearchParams({ text, filter: 'countrycode:us', format: 'json', limit: '7', apiKey });
  const response = await fetch(url, { signal });
  if (!response.ok) {
    console.error('Geoapify autocomplete returned HTTP', response.status);
    throw new Error('Address lookup unavailable');
  }

  const { results } = await response.json();
  const matches = new Map();
  for (const address of results ?? []) {
    const { country_code, formatted, housenumber, street, result_type, rank, lat, lon } = address;
    if (country_code !== 'us' || !street || (!housenumber && result_type !== 'street') ||
        typeof formatted !== 'string' || !formatted || formatted.length > 120 ||
        !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const streetOnly = !housenumber || result_type === 'street' ||
      rank?.match_type === 'match_by_street' || rank?.confidence_building_level === 0;
    const label = streetOnly
      ? [street, [address.city, address.state_code, address.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      : formatted;
    matches.set(label, { label, point: [lat, lon], streetOnly });
  }
  return [...matches.values()].sort((a, b) => Number(a.streetOnly) - Number(b.streetOnly));
}

export default async function addressSuggestions(request) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  }

  const body = await request.json().catch(() => null);
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (query.length < 5 || query.length > 120) {
    return Response.json([], { status: 400, headers });
  }

  const apiKey = process.env.GEOAPIFY_ROUTING_KEY?.trim();
  if (!apiKey) {
    console.error('Geoapify key is missing from this deploy context.');
    return Response.json([], { status: 503, headers });
  }

  try {
    const signal = AbortSignal.timeout(9000);
    let matches = await findStreets(query, apiKey, signal);
    const streetQuery = query.replace(/^\d+[a-z]?(?:-\d+[a-z]?)?\s+/i, '');
    if (!matches.length && streetQuery !== query && streetQuery.length >= 5) {
      const streets = await findStreets(streetQuery, apiKey, signal);
      matches = streets.filter(place => place.streetOnly);
    }
    return Response.json(matches, { headers });
  } catch (error) {
    console.error('Geoapify autocomplete request failed:', error.name);
    return Response.json([], { status: 503, headers });
  }
}
