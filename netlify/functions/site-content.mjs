import { defaults } from '../../public/assets/business-defaults.js';
import { isLocalPreview, json, readRecord } from '../lib/store.mjs';
import { publishedWebsiteContent } from '../lib/website-content.mjs';

export default async function siteContent(request) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  try {
    const [settings, publication] = await Promise.all([readRecord('settings'), readRecord('review-publication')]);
    return json({ settings: publishedWebsiteContent(settings.data), reviews: publication.data?.reviews ?? null, localPreview: isLocalPreview(request) });
  } catch {
    return json({ settings: defaults, reviews: null, localPreview: isLocalPreview(request) });
  }
}
