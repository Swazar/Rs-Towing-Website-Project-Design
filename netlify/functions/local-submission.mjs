import { isLocalPreview, sameOrigin, json } from '../lib/store.mjs';
import { validateSubmission } from '../lib/validation.mjs';
import { addLocalSubmission } from '../lib/submissions.mjs';

export default async function localSubmission(request) {
  if (!isLocalPreview(request)) return json({ error: 'Not found.' }, 404);
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  try {
    sameOrigin(request);
    if (Number(request.headers.get('content-length')) > 16000) return json({ error: 'Request too large.' }, 413);
    const body = await request.text();
    if (body.length > 16000) return json({ error: 'Request too large.' }, 413);
    const data = validateSubmission(Object.fromEntries(new URLSearchParams(body)));
    const requestId = /^[a-f0-9-]{36}$/.test(data.request_id) ? data.request_id : crypto.randomUUID();
    await addLocalSubmission(data, requestId);
    return json({ received: true, localPreview: true });
  } catch (error) {
    return json({ error: error.status ? error.message : 'Could not save the test request.' }, error.status ?? 503);
  }
}
