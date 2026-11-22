import { readRecord, writeRecord, isLocalPreview, deployContext } from './store.mjs';
import { readRecoveredSubmissions } from './submission-archive.mjs';

const apiBase = 'https://api.netlify.com/api/v1';

export async function listOriginalSubmissions(request) {
  if (isLocalPreview(request)) return (await readRecord('local-submissions')).data ?? [];
  // Deploy previews share the live Forms site ID. Keep their inbox isolated.
  if (deployContext() !== 'production') return [];
  const site = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_FORMS_TOKEN;
  if (!site || !token) throw Object.assign(new Error('Connect the Netlify Forms token to load live enquiries.'), { status: 503 });
  const items = [];
  const deadline = AbortSignal.timeout(20_000);
  // Netlify paginates submissions. Avoid silently omitting older enquiries.
  for (let page = 1; ; page++) {
    const url = new URL(`${apiBase}/sites/${encodeURIComponent(site)}/submissions`);
    url.search = new URLSearchParams({ per_page: '100', page: String(page) });
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([deadline, AbortSignal.timeout(8000)]) });
    if (!response.ok) throw Object.assign(new Error('Netlify submissions could not be loaded. Try again.'), { status: 503 });
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Unexpected submissions response');
    items.push(...batch.filter(item => !item.is_spam && ['quote-request', 'customer-review'].includes(item.form_name || item.data?.['form-name'])));
    if (batch.length < 100) break;
  }
  return items;
}

export async function listSubmissions(request) {
  if (!isLocalPreview(request) && deployContext() !== 'production') return [];
  const [originals, recovered] = await Promise.all([listOriginalSubmissions(request), readRecoveredSubmissions()]);
  const ids = new Set(originals.map(item => item.id));
  return [...originals, ...recovered.filter(item => !ids.has(item.id))];
}

export async function addLocalSubmission(data, requestId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const record = await readRecord('local-submissions');
    const items = record.data ?? [];
    if (items.some(item => item.id === requestId)) return requestId;
    const submission = {
      id: requestId, form_name: data['form-name'], created_at: new Date().toISOString(), data,
    };
    try {
      await writeRecord('local-submissions', [submission, ...items].slice(0, 200), record.revision);
      return requestId;
    } catch (error) {
      if (error.status !== 409 || attempt === 2) throw error;
    }
  }
}
