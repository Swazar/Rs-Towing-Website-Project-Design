import { compile } from 'html-to-text';
import { mapInBatches } from './store.mjs';
import { reconnectGmail } from './gmail-account.mjs';
import { maxMailText, readableMailHtml } from './gmail-content.mjs';
import { formattedMail, mailContentId } from './gmail-formatted.mjs';
import { inlineImagePart, loadInlineImages } from './gmail-inline-images.mjs';

export const gmailBase = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const pageSize = 12;
const maxMessages = 20;
const maxReplyBytes = 8_000_000;
export const gmailResourceId = /^[\da-z_-]{1,128}$/i;
const folderLabels = new Map([
  ['inbox', ['INBOX']],
  ['unread', ['INBOX', 'UNREAD']],
  ['read', ['INBOX']],
  ['starred', ['STARRED']],
  ['sent', ['SENT']],
  ['attachments', []],
  ['all', []],
]);
const asText = compile({
  wordwrap: false,
  limits: { maxInputLength: 240_000, maxDepth: 70, maxChildNodes: 300 },
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    ...['img', 'style', 'script', 'iframe', 'head', 'noscript'].map(selector => ({ selector, format: 'skip' })),
  ],
});

export function inboxQuery(body) {
  const q = body?.q ?? '';
  const page = body?.page ?? '';
  const folder = body?.folder ?? 'inbox';
  if (typeof q !== 'string' || q.length > 250 || /[\x00-\x1f\x7f]/.test(q) ||
      typeof page !== 'string' || page.length > 2048 || /[\x00-\x20\x7f]/.test(page) || !folderLabels.has(folder)) {
    throw Object.assign(new Error('Check the search and try again.'), { status: 400 });
  }
  return { q: q.trim(), page, folder };
}

export function conversationId(body) {
  if (typeof body?.id !== 'string' || !gmailResourceId.test(body.id)) {
    throw Object.assign(new Error('Choose a Gmail conversation.'), { status: 400 });
  }
  return body.id;
}

export async function readLimitedJson(response, limit, oversized = 'This conversation is too large for the preview. Open it in Gmail.') {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((bytes += value.byteLength) > limit) {
        await reader.cancel();
        throw Object.assign(new Error(oversized), { status: 413 });
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
}

export async function gmailGet(path, params, token, fetcher, { detail = false } = {}) {
  const url = new URL(path, gmailBase);
  url.search = params.toString();
  const response = await fetcher(url, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(4_000) });
  if (response.ok) return readLimitedJson(response, detail ? maxReplyBytes : 1_000_000);
  if (response.status === 401) throw reconnectGmail();
  if (response.status === 404) throw Object.assign(new Error('This conversation is no longer available.'), { status: 404 });
  if (response.status === 400 && params.has('pageToken')) throw Object.assign(new Error('This inbox page expired. Refresh to start from the first page.'), { status: 400 });
  const data = await readLimitedJson(response, 24_000).catch(() => ({}));
  const reasons = [...(data.error?.errors ?? []), ...(data.error?.details ?? [])].map(entry => entry.reason);
  if (reasons.some(reason => ['accessNotConfigured', 'SERVICE_DISABLED'].includes(reason))) {
    throw Object.assign(new Error('Enable the Gmail API in the Google Cloud project for this connection.'), { status: 424 });
  }
  if (response.status === 429 || reasons.some(reason => /quota|ratelimit/i.test(reason ?? ''))) {
    throw Object.assign(new Error('Gmail is busy. Try again shortly.'), { status: 429 });
  }
  if (reasons.some(reason => ['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'].includes(reason))) throw reconnectGmail();
  throw new Error('Gmail could not return the mailbox.');
}

const clean = (value, limit) => typeof value === 'string' ? value.slice(0, limit).trim() : '';
const header = (payload, name, limit) => clean(payload?.headers?.find(item => item.name?.toLowerCase() === name)?.value, limit);
const messagesIn = thread => [...(thread.messages ?? [])].sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
const subjectOf = messages => messages.map(message => header(message.payload, 'subject', 400)).find(Boolean) || '(No subject)';
const snippet = value => asText(clean(value, 1500)).slice(0, 320);
const timestamp = value => Math.abs(Number(value)) <= 8.64e15 ? Number(value) : null;

function threadSummary(thread, sent) {
  const messages = messagesIn(thread);
  const latest = (sent ? messages.findLast(message => message.labelIds?.includes('SENT')) : null) ?? messages.at(-1);
  const recipient = sent ? header(latest?.payload, 'to', 400) : '';
  return {
    id: thread.id,
    subject: subjectOf(messages),
    from: header(latest?.payload, 'from', 400) || '(Unknown sender)',
    at: timestamp(latest?.internalDate),
    unread: messages.some(message => message.labelIds?.includes('UNREAD')),
    snippet: snippet((sent && latest?.snippet) || thread.snippet || latest?.snippet),
    ...(recipient ? { recipient } : {}),
  };
}

export async function listGmailThreads(token, { q, page, folder = 'inbox' }, fetcher = fetch) {
  const params = new URLSearchParams({ maxResults: String(pageSize), fields: 'nextPageToken,threads(id,snippet)' });
  if (q) params.set('q', q);
  else if (folder === 'attachments') params.set('q', 'has:attachment');
  else {
    for (const label of folderLabels.get(folder)) params.append('labelIds', label);
    if (folder === 'read') params.set('q', 'is:read');
  }
  if (page) params.set('pageToken', page);
  const result = await gmailGet('threads', params, token, fetcher);
  const metadata = new URLSearchParams({
    format: 'metadata', fields: 'id,snippet,messages(internalDate,labelIds,snippet,payload(headers))',
  });
  metadata.append('metadataHeaders', 'From');
  metadata.append('metadataHeaders', 'Subject');
  if (folder === 'sent' && !q) metadata.append('metadataHeaders', 'To');
  const entries = (result.threads ?? []).slice(0, pageSize).filter(thread => typeof thread.id === 'string' && gmailResourceId.test(thread.id));
  const threads = await mapInBatches(entries, async entry => {
    try {
      const thread = await gmailGet('threads/' + entry.id, metadata, token, fetcher);
      const summary = threadSummary({ ...thread, snippet: thread.snippet || entry.snippet }, folder === 'sent' && !q);
      return folder === 'read' && !q && summary.unread ? null : summary;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }, 4);
  return { threads: threads.filter(Boolean), nextPage: result.nextPageToken ?? null };
}

function bodyParts(part, found, depth = 0) {
  if (!part || depth > 30) return;
  const disposition = header(part, 'content-disposition', 200).toLowerCase();
  const name = clean(part.filename, 250);
  const type = part.mimeType?.toLowerCase();
  const cid = mailContentId(header(part, 'content-id', 300));
  if (cid && !disposition.startsWith('attachment') && type?.startsWith('image/')) {
    const image = inlineImagePart(type, part.body);
    if (image && !found.inlineImages.has(cid)) {
      found.inlineImages.set(cid, { ...image, index: found.inlineImages.size });
    }
    return;
  }
  if (name || disposition.startsWith('attachment')) {
    const inline = disposition.startsWith('inline') || (!disposition.startsWith('attachment') && Boolean(header(part, 'content-id', 200)));
    if (!inline && found.attachments.length < 30) {
      const size = part.body?.size;
      found.attachments.push({ name: name || 'Attachment', size: Number.isSafeInteger(size) && size >= 0 ? size : null });
    }
    return;
  }
  if (['text/plain', 'text/html'].includes(type) && typeof part.body?.data === 'string') {
    const bytes = Buffer.from(part.body.data.slice(0, 480_000), 'base64url');
    const charset = header(part, 'content-type', 500).match(/charset\s*=\s*["']?([^"';\s]+)/i)?.[1] || 'utf-8';
    let text;
    try { text = new TextDecoder(charset).decode(bytes); }
    catch { text = bytes.toString('utf8'); }
    if (text.trim()) found[type].push(text.trim());
    return;
  }
  if (type?.startsWith('multipart/')) for (const child of part.parts ?? []) bodyParts(child, found, depth + 1);
}

async function messageBody(message, budget, fetchAttachment) {
  const parts = { 'text/plain': [], 'text/html': [], attachments: [], inlineImages: new Map() };
  bodyParts(message.payload, parts);
  const markup = parts['text/html'];
  const html = markup.length ? readableMailHtml(markup) : null;
  const formatted = await loadInlineImages(formattedMail(markup, parts.inlineImages), parts.inlineImages, budget, fetchAttachment);
  const body = parts['text/plain'].join('\n\n') || (html ? asText(markup.join('\n\n')) : '');
  return {
    body: body.slice(0, maxMailText) || snippet(message.snippet),
    ...(html?.content.length ? { content: html.content } : {}),
    ...(formatted ? { formatted } : html?.imageHeavy ? { visualPreview: { summary: snippet(message.snippet) } } : {}),
    ...(parts.attachments.length ? { attachments: parts.attachments } : {}),
    previewOnly: Boolean(html?.truncated || (!html?.content.length && (!body || body.length > maxMailText))),
  };
}

export async function readGmailThread(token, id, fetcher = fetch) {
  const params = new URLSearchParams({ format: 'full', fields: 'id,messages(id,internalDate,snippet,payload)' });
  const thread = await gmailGet('threads/' + id, params, token, fetcher, { detail: true });
  const messages = messagesIn(thread);
  const budget = { bytes: 600_000, count: 8 };
  const previews = await mapInBatches(messages.slice(-maxMessages).reverse(), async message => {
    const fetchAttachment = attachmentId => {
      if (typeof message.id !== 'string' || !gmailResourceId.test(message.id)) throw new Error('Invalid Gmail message.');
      return gmailGet('messages/' + message.id + '/attachments/' + attachmentId,
        new URLSearchParams({ fields: 'size,data' }), token, fetcher);
    };
    return {
      id: message.id, from: header(message.payload, 'from', 400) || '(Unknown sender)',
      to: header(message.payload, 'to', 600), cc: header(message.payload, 'cc', 600),
      replyTo: header(message.payload, 'reply-to', 400), at: timestamp(message.internalDate),
      ...await messageBody(message, budget, fetchAttachment),
    };
  }, 3);
  return {
    id, subject: subjectOf(messages), earlier: Math.max(messages.length - maxMessages, 0),
    messages: previews.reverse(),
  };
}
