import { defaults } from '../../public/assets/business-defaults.js';
import { isLocalPreview, json, readRecord } from '../lib/store.mjs';
import { withMediaDefaults } from '../../public/assets/site-media.js';

export default async function siteContent(request) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  try {
    const [settings, publication] = await Promise.all([readRecord('settings'), readRecord('review-publication')]);
    const content = settings.data ? Object.fromEntries(Object.keys(defaults).map(key => [key, settings.data[key]])) : defaults;
    return json({ settings: withMediaDefaults(content), reviews: publication.data?.reviews ?? null, localPreview: isLocalPreview(request) });
  } catch {
    return json({ settings: defaults, reviews: null, localPreview: isLocalPreview(request) });
  }
}
