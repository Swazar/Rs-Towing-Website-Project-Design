import { createHash } from 'node:crypto';
import { businessDateKey } from '../../src/domain/jobs/dates.ts';
import { deployContext, readRecord, writeRecord, recordPages, mapInBatches } from './store.mjs';

const quoteLimit = 25;
const retryWindow = 12 * 60 * 60_000;
const maxAttempts = 5;
const store = { read: readRecord, write: writeRecord, pages: recordPages };

export function mailSettings(env = process.env, context = deployContext(env)) {
  if (context !== 'production' || env.NETLIFY_DEV === 'true') return null;
  if (!env.RESEND_API_KEY || !env.RS_MAIL_FROM || !env.RS_ALERT_EMAIL || !env.URL) return null;
  const url = new URL(env.URL);
  if (url.protocol !== 'https:') return null;
  return { apiKey: env.RESEND_API_KEY, from: env.RS_MAIL_FROM, to: env.RS_ALERT_EMAIL,
    admin: new URL('/admin/', url).href, quotes: env.RS_QUOTE_EMAILS === 'true', pickups: env.RS_PICKUP_EMAILS === 'true' };
}

async function update(key, change, storage) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await storage.read(key);
    const next = change(current.data ?? {});
    if (!next) return;
    try { return await storage.write(key, next, current.revision); }
    catch (error) { if (error.status !== 409 || attempt === 4) throw error; }
  }
}

function dayOffset(now, days) {
  const date = new Date(businessDateKey(new Date(now)) + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function email(settings, subject, message) {
  return { from: settings.from, to: [settings.to], subject, text: message };
}

export async function enqueueQuote(data, settings, now = Date.now(), storage = store) {
  if (!settings?.quotes || data?.['form-name'] !== 'quote-request' || data['bot-field']) return null;
  const fields = [data.name, data.phone, data.pickup, data.dropoff, data.service, data.details];
  if (fields.some(value => typeof value !== 'string' || !value.trim())) return null;
  const requestId = /^[\da-f-]{36}$/i.test(data.request_id || '') ? data.request_id : null;
  const key = 'mail/quotes/' + dayOffset(now, 0);
  const id = createHash('sha256').update(requestId || JSON.stringify(fields)).digest('hex');
  const stage = await update(key, entries => {
    if (entries[id] || Object.keys(entries).length >= quoteLimit) return;
    return { ...entries, [id]: { created: now, attempts: 0,
      message: email(settings, 'New RS on the Go quote request', 'A new quote request is ready in Enquiries.\n\n' + settings.admin + '#enquiries') } };
  }, storage);
  return stage ? { key, id } : null;
}

async function send(message, key, settings) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + settings.apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) throw new Error('Email provider returned HTTP ' + response.status);
}

export async function deliverNotification(key, id, settings, { now = Date.now(), storage = store, deliver = send } = {}) {
  const claim = await update(key, entries => {
    const item = entries[id];
    if (!item || item.sent || item.attempts >= maxAttempts || now - item.created >= retryWindow || item.retryAt > now) return;
    return { ...entries, [id]: { ...item, attempts: item.attempts + 1, retryAt: now + 15 * 60_000 } };
  }, storage);
  if (!claim) return false;
  const item = claim.data[id];
  await deliver(item.message, key.startsWith('mail/quotes/') ? 'quote/' + id : key + '/' + id, settings);
  await update(key, entries => ({ ...entries, [id]: { ...entries[id], sent: now, message: null } }), storage);
  return true;
}

async function queuePickupDigests(settings, now, storage) {
  const today = dayOffset(now, 0);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(now));
  if (hour < 8) return [];
  const key = 'mail/pickups/' + today;
  const tomorrow = dayOffset(now, 1);
  const pickupIds = new Set();
  for await (const keys of storage.pages('enquiry/')) {
    const states = await mapInBatches(keys, async key => (await storage.read(key)).data);
    states.forEach((state, index) => {
      if (state?.scheduledDate === tomorrow && state.status !== 'Closed') pickupIds.add(keys[index]);
    });
  }
  const updated = await update(key, entries => {
    // Older digests did not record individual pickups. Seed their coverage once
    // so upgrading mid-day does not resend a digest for the same jobs.
    if (entries.digest && !entries.covered) return { ...entries, covered: [...pickupIds] };
    const covered = new Set(entries.covered ?? []);
    const added = [...pickupIds].filter(id => !covered.has(id)).sort();
    if (!added.length) return;
    const count = added.length;
    const followUp = Boolean(entries.digest);
    const id = followUp ? 'added-' + createHash('sha256').update(JSON.stringify(added)).digest('hex') : 'digest';
    const subject = followUp ? 'Additional pickups on ' + tomorrow : 'Confirmed pickups tomorrow';
    const text = `You have ${count} ${followUp ? 'additional confirmed' : 'confirmed'} pickup${count === 1 ? '' : 's'} on ${tomorrow} (Eastern time). Open the workspace calendar for details.\n\n${settings.admin}#overview`;
    // Coverage and queue entry are recorded together so overlapping runs
    // cannot reserve the same pickup under two delivery keys.
    const { empty, ...active } = entries;
    return { ...active, covered: [...covered, ...added], [id]: { created: now, attempts: 0, message: email(settings, subject, text) } };
  }, storage);
  const entries = updated?.data ?? (await storage.read(key)).data ?? {};
  return Object.entries(entries).filter(([, item]) =>
    item?.message && !item.sent && item.attempts < maxAttempts && now - item.created < retryWindow && !(item.retryAt > now)
  ).slice(0, 3).map(([id]) => [key, id]);
}

export async function runNotifications(settings, { now = Date.now(), storage = store, deliver = send } = {}) {
  const options = { now, storage, deliver };
  const attempt = async (key, id) => {
    try { await deliverNotification(key, id, settings, options); }
    catch (error) { console.error('Admin notification delivery failed:', error.name); }
  };
  if (settings.quotes) {
    const targets = [];
    for (const offset of [0, -1]) {
      const key = 'mail/quotes/' + dayOffset(now, offset);
      const entries = (await storage.read(key)).data || {};
      for (const [id, item] of Object.entries(entries)) {
        if (!item.sent && item.attempts < maxAttempts && now - item.created < retryWindow && !(item.retryAt > now)) targets.push([key, id]);
      }
    }
    await Promise.all(targets.slice(0, 3).map(([key, id]) => attempt(key, id)));
  }
  if (settings.pickups) {
    const targets = await queuePickupDigests(settings, now, storage);
    await Promise.all(targets.map(([key, id]) => attempt(key, id)));
  }
}
