import { requireWorkspaceUser } from '../lib/workspace-user.mjs';
import { permissionsFor } from '../lib/owner-access.mjs';
import { json, sameOrigin, readRecord } from '../lib/store.mjs';
import { saveImage } from '../lib/media.mjs';

export const config = { rateLimit: { action: 'rate_limit', windowLimit: 30, windowSize: 60, aggregateBy: ['ip'] } };
export default async function ownerMedia(request) {
  try {
    if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
    const user = await requireWorkspaceUser(request);
    if (!permissionsFor(user).includes('content')) return json({ error: 'Image uploads and the image library are reserved for the owner.' }, 403);
    if (request.method === 'GET') {
      const offset = Math.max(0, Math.min(1000, Number.parseInt(new URL(request.url).searchParams.get('offset') || '0', 10) || 0));
      const all = (await readRecord('media-index')).data || [];
      return json({ items: all.slice(offset, offset + 48), nextOffset: offset + 48 < all.length ? offset + 48 : null });
    }
    sameOrigin(request);
    const raw = await request.text(); if (raw.length > 2200000) return json({ error: 'This image is too large. Choose a smaller photo.' }, 413);
    const result = await saveImage(JSON.parse(raw), user); return json(result);
  } catch (error) {
    return json({ error: error.status ? error.message : error instanceof SyntaxError ? 'Check the upload and try again.' : 'The image could not be saved. Try again.' }, error.status || (error instanceof SyntaxError ? 400 : 503));
  }
}
