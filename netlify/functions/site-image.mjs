import { readRecord } from '../lib/store.mjs';
import { requireWorkspaceUser } from '../lib/workspace-user.mjs';
import { permissionsFor } from '../lib/owner-access.mjs';
import { imageIsPublished, mediaIdPattern } from '../../public/assets/site-media.js';

export default async function siteImage(request) {
  const unavailable = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const query = new URL(request.url).searchParams, id = query.get('id'); if (!mediaIdPattern.test(id || '')) return unavailable();
  try {
    const settings = await readRecord('settings'), published = imageIsPublished(id, settings.data);
    if (!published) {
      try { if (!permissionsFor(await requireWorkspaceUser(request)).includes('content')) return unavailable(); }
      catch { return unavailable(); }
    }
    const record = (await readRecord('media/' + id)).data; if (!record) return unavailable();
    const bytes = Buffer.from(query.get('size') === 'small' ? record.smallData : record.data, 'base64');
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
      'Content-Type': 'image/webp', 'Content-Length': String(bytes.length), 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': published ? 'public, max-age=300' : 'private, no-store',
      'Netlify-CDN-Cache-Control': published ? 'public, max-age=300' : 'no-store',
    } });
  } catch { return unavailable(); }
}
