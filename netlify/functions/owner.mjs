import { getUser, logout } from '@netlify/identity';
import { validateProfile } from '../lib/profile.mjs';
import { requireIdentityUser } from '../lib/workspace-user.mjs';
import { checkWorkspaceSession, closeWorkspaceSession, openWorkspaceSession, workspaceCookie } from '../lib/workspace-session.mjs';
import { resolveSettingsImages } from '../lib/media-records.mjs';
import { withMediaDefaults } from '../../public/assets/site-media.js';
import { defaults } from '../../public/assets/business-defaults.js';
import { isLocalPreview, json, sameOrigin, readRecord, writeRecord } from '../lib/store.mjs';
import { listSubmissions } from '../lib/submissions.mjs';
import { publicReview, text, validateSettings } from '../lib/validation.mjs';
import { permissionsFor, canUseAction, addHistory } from '../lib/owner-access.mjs';
import { validDate } from '../../src/domain/jobs/dates.ts';
import { filterEnquiries, enquiryCSV } from '../../src/domain/jobs/queries.ts';
import { validateEnquiry } from '../lib/enquiry.mjs';
import { activeData, saveRecoverable, versionsFor } from '../lib/recovery.mjs';
import { loadWorkspaceInbox } from '../lib/jobs/workspace-inbox.ts';
import { isQuote } from '../../src/domain/jobs/types.ts';
import { assistantKey } from '../lib/assistant-ai.mjs';
import { quoteAlertSummary } from '../lib/notification-mail.mjs';
import { submissionBackups } from '../lib/submission-backups.mjs';

export const config = { rateLimit: { action: 'rate_limit', windowLimit: 60, windowSize: 60, aggregateBy: ['ip'] } };

function sessionResponse(payload, token) {
  const response = json(payload);
  response.headers.append('Set-Cookie', workspaceCookie(token));
  return response;
}

export default async function owner(request) {
  const action = new URL(request.url).searchParams.get('action') || 'session';
  try {
    if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
    if (request.method === 'POST') sameOrigin(request);
    let body = {};
    if (request.method === 'POST') {
      const raw = await request.text();
      if (raw.length > (action === 'profile' ? 120000 : 20000)) return json({ error: 'Request too large.' }, 413);
      body = JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Check the submitted details.' }, 400);
    }
    if (action === 'logout' && request.method === 'POST') {
      if (isLocalPreview(request)) return json({ signedOut: true });
      try { await closeWorkspaceSession(request, await getUser()); }
      finally { await logout(); }
      return sessionResponse({ signedOut: true });
    }
    const user = await requireIdentityUser(request);
    if (action === 'session-start' && request.method === 'POST') {
      if (isLocalPreview(request)) return json({ signedIn: true });
      return sessionResponse({ signedIn: true }, await openWorkspaceSession(request, user, { freshIdentity: true }));
    }
    const expiresAt = await checkWorkspaceSession(request, user, { touch: action === 'session-touch' && request.method === 'POST' });
    if (action === 'session-touch' && request.method === 'POST') return json({ expiresAt });
    if (!canUseAction(user, action, request.method)) return json({ error: 'Your role cannot perform this action.' }, 403);
    const permissions = permissionsFor(user);
    const actor = { id: user.id, email: user.email };
    if (action === 'session' && request.method === 'GET') {
      return json({ user: actor, role: user.roles.includes('owner') ? 'Owner' : 'Staff', permissions, localPreview: isLocalPreview(request), expiresAt, assistantAvailable: Boolean(assistantKey(request)) });
    }
    if (action === 'backups') {
      const backups = submissionBackups();
      if (request.method === 'GET') return json(await backups.status());
      if (body.operation === 'capture') return json(await backups.capture(request));
      if (body.operation === 'restore') return json(await backups.restore(request, body.id));
      return json({ error: 'Choose a backup action.' }, 400);
    }
    if (action === 'backup-download') return await submissionBackups().download(new URL(request.url).searchParams.get('id'));
    if (action === 'profile') {
      const key = 'profile/' + Buffer.from(String(user.id)).toString('hex');
      const current = await readRecord(key);
      if (request.method === 'GET') return json(current);
      return json(await writeRecord(key, validateProfile(body, current.data), body.revision));
    }
    if (action === 'versions') {
      const id = request.method === 'GET' ? new URL(request.url).searchParams.get('id') : body.id;
      if (id != null && (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id))) return json({ error: 'Choose a valid enquiry.' }, 400);
      const key = id ? 'enquiry/' + id : 'settings';
      const current = await readRecord(key);
      if (request.method === 'GET') return json({ versions: versionsFor(key, current.data), revision: current.revision, current: activeData(current.data) });
      if (body.revision !== current.revision) return json({ error: 'This record changed. Reopen version history and try again.' }, 409);
      const version = versionsFor(key, current.data).find(entry => entry.id === body.version);
      if (!version) return json({ error: 'This version is unavailable.' }, 404);
      if (!id) version.data = await resolveSettingsImages(validateSettings(version.data));
      return json(await saveRecoverable(key, version.data, current, body.revision, actor, 'Restored previous version', id || 'Website content'));
    }
    if (action === 'content' && request.method === 'GET') {
      const saved = await readRecord('settings');
      if (!permissions.includes('content')) return json({ data: withMediaDefaults(saved.data ? Object.fromEntries(Object.keys(defaults).map(key => [key, saved.data[key]])) : defaults), revision: null });
      return json({ ...saved, data: withMediaDefaults(activeData(saved.data) ?? defaults) });
    }
    if (action === 'content' && request.method === 'POST') {
      const settings = await resolveSettingsImages(validateSettings(body.data));
      const current = await readRecord('settings');
      const saved = await saveRecoverable('settings', settings, current, body.revision, actor, 'Published website changes', 'Website content');
      return json(saved);
    }
    if (['list', 'export'].includes(action) && request.method === 'GET') {
      const { items, reviewActivity } = await loadWorkspaceInbox(request, action !== 'export' && permissions.includes('reviews'));
      if (action === 'export') {
        const query = Object.fromEntries(new URL(request.url).searchParams);
        return new Response(enquiryCSV(filterEnquiries(items, query)), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="rs-enquiries.csv"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      }
      const [reminders, quoteAlerts] = await Promise.all([
        readRecord('reminders'),
        permissions.includes('activity') ? quoteAlertSummary().catch(() => null) : null,
      ]);
      let activity = [];
      if (permissions.includes('activity')) {
        const settings = await readRecord('settings');
        activity = [...(settings.data?.history || []), ...reviewActivity, ...(reminders.data?.history || []), ...items.flatMap(item => item.state?.history || [])]
          .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
      } else items.forEach(item => { if (item.state) { const { history, ...state } = item.state; item.state = state; } });
      return json({ items: items.sort((a, b) => b.created_at.localeCompare(a.created_at)), reminders: { data: reminders.data?.items || [], revision: reminders.revision }, activity, quoteAlerts });
    }
    if (action === 'reminder' && request.method === 'POST') {
      const current = await readRecord('reminders');
      const title = text(body.title, 120, 'reminder title', true);
      if (!validDate(body.date) || typeof body.done !== 'boolean' || !/^[\w-]{1,100}$/.test(body.id || '')) return json({ error: 'Check the reminder title and date.' }, 400);
      const items = [...(current.data?.items || [])], index = items.findIndex(item => item.id === body.id);
      if (index < 0 && items.length >= 2000) return json({ error: 'The reminder limit has been reached.' }, 400);
      const entry = { id: body.id, title, date: body.date, done: body.done, updatedAt: new Date().toISOString(), updatedBy: actor.email };
      if (index < 0) items.push(entry); else items[index] = entry;
      const saved = await writeRecord('reminders', { items, history: addHistory(current.data, actor, body.done ? 'Completed reminder' : index < 0 ? 'Added reminder' : 'Updated reminder', title) }, body.revision);
      return json({ data: saved.data.items, revision: saved.revision });
    }
    if (action === 'enquiry' && request.method === 'POST') {
      if (typeof body.id !== 'string' || !/^[\w-]{1,100}$/.test(body.id)) return json({ error: 'Choose a valid enquiry.' }, 400);
      const all = await listSubmissions(request);
      if (!all.some(item => item.id === body.id && isQuote(item))) return json({ error: 'Enquiry not found.' }, 404);
      const key = 'enquiry/' + body.id;
      const current = await readRecord(key);
      const next = validateEnquiry(body, current.data);
      const labels = { status: 'status', note: 'note', followUp: 'follow-up', scheduledDate: 'pickup date', scheduledTime: 'pickup time', priceCents: 'agreed price' };
      const changes = Object.keys(next).filter(field => (current.data?.[field] ?? '') !== (next[field] ?? '')).map(field => labels[field]);
      const description = changes.length ? 'Updated enquiry · ' + changes.join(', ') : 'Saved enquiry';
      const saved = await saveRecoverable(key, next, current, body.revision, actor, description, body.id);
      return json(saved);
    }
    if (action === 'review' && request.method === 'POST') {
      if (!['Published', 'Unpublished', 'Spam'].includes(body.publication) || !/^[\w-]{1,100}$/.test(body.id || '')) return json({ error: 'Choose a review action.' }, 400);
      const all = await listSubmissions(request);
      const item = all.find(entry => entry.id === body.id && (entry.form_name || entry.data['form-name']) === 'customer-review');
      if (!item) return json({ error: 'Review not found.' }, 404);
      if (body.publication === 'Published' && item.data['publish-permission'] !== 'yes') return json({ error: 'This customer did not give permission to publish.' }, 400);
      const current = await readRecord('review-publication');
      if ((body.revision ?? null) !== current.revision) return json({ error: 'The reviews changed. Reload before saving.' }, 409);
      const decisions = { ...current.data?.decisions, [body.id]: {
        publication: body.publication, updatedBy: actor.email, updatedAt: new Date().toISOString(),
      } };
      const reviews = all.filter(entry => (entry.form_name || entry.data['form-name']) === 'customer-review')
        .map(entry => publicReview(entry, decisions[entry.id])).filter(Boolean)
        .sort((a, b) => b.date.localeCompare(a.date));
      const saved = await writeRecord('review-publication', { decisions, reviews, history: addHistory(current.data, actor, body.publication + ' review', item.data.first_name || 'Customer') }, current.revision);
      return json({ revision: saved.revision });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Check the submitted details.' }, 400);
    return json({ error: error.status ? error.message : 'This action could not be completed. Check the setup and try again.' }, error.status ?? 503);
  }
}
