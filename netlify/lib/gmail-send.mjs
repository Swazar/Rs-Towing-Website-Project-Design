import MailComposer from 'nodemailer/lib/mail-composer';
import { mailAddress, mailLimits } from '../../src/domain/mail/compose.ts';
import { digest, gmailSendAccess, reconnectGmail } from './gmail-account.mjs';
import { gmailBase, gmailGet, gmailResourceId, readLimitedJson } from './gmail-inbox.mjs';

export const sendBodyLimit = 4_500_000;
const day = 24 * 60 * 60 * 1000;
export const validMailRequest = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validMessageId = /<[^<>\s\x00-\x1f\x7f]{1,250}>/g;
const badRequest = message => Object.assign(new Error(message), { status: 400 });
const uncertain = () => Object.assign(new Error('Delivery could not be confirmed. Check Gmail Sent before sending again.'), { status: 409, code: 'gmail-send-unknown' });
const rejected = (message, status) => Object.assign(new Error(message), { status, code: 'gmail-send-rejected' });

export function outgoingMail(body) {
  if (typeof body?.requestId !== 'string' || !validMailRequest.test(body.requestId)) throw badRequest('Reopen the composer before sending.');
  const recipients = new Set();
  const groups = {};
  for (const field of ['to', 'cc', 'bcc']) {
    const entries = body[field];
    if (!Array.isArray(entries) || entries.length > mailLimits.recipients) throw badRequest('Check the recipient addresses.');
    groups[field] = [];
    for (const entry of entries) {
      if (typeof entry !== 'string' || !mailAddress(entry)) throw badRequest('Enter complete email addresses for each recipient.');
      const key = entry.toLowerCase();
      if (recipients.has(key)) throw badRequest('Add each recipient only once.');
      recipients.add(key);
      groups[field].push(entry);
    }
  }
  if (!recipients.size || recipients.size > mailLimits.recipients) throw badRequest('Add between 1 and 20 recipients.');
  if (typeof body.subject !== 'string' || body.subject.length > mailLimits.subject || /[\x00-\x1f\x7f]/.test(body.subject)) throw badRequest('Check the subject line.');
  if (typeof body.text !== 'string' || body.text.length > mailLimits.text || body.text.includes('\0')) throw badRequest('Check the message length.');
  const attachments = mailAttachments(body.attachments);
  if (!body.text.trim() && !attachments.length) throw badRequest('Write a message or attach a file.');
  const reply = mailReply(body.reply);
  const { subject, text, requestId } = body;
  const fingerprint = digest(JSON.stringify([groups, subject, text, body.attachments, reply]));
  return { ...groups, requestId, subject: subject.trim(), text, attachments, reply, fingerprint };
}

export function mailAttachments(files) {
  if (!Array.isArray(files) || files.length > mailLimits.attachments) throw badRequest('Attach up to 10 files.');
  let bytes = 0;
  return files.map(file => {
    const { name, data } = file ?? {};
    if (typeof name !== 'string' || !name.trim() || name.length > 180 || /[\x00-\x1f\x7f/\\]/.test(name) ||
      typeof data !== 'string' || !data || data.length > mailLimits.attachmentBytes * 4 / 3 ||
      data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw badRequest('An attachment is invalid. Remove it and attach it again.');
    const content = Buffer.from(data, 'base64');
    if (!content.length || content.toString('base64') !== data) throw badRequest('An attachment could not be read.');
    bytes += content.byteLength;
    if (bytes > mailLimits.attachmentBytes) throw Object.assign(new Error('Attachments must be 3 MB total or smaller.'), { status: 413 });
    return { filename: name.trim(), content };
  });
}

export function mailReply(reply) {
  if (reply !== undefined) {
    const { threadId, messageId } = reply ?? {};
    if (![threadId, messageId].every(id => typeof id === 'string' && gmailResourceId.test(id))) throw badRequest('Choose a message to reply to.');
    return { threadId, messageId };
  }
}

async function replyEnvelope(token, reply, fetcher) {
  const query = new URLSearchParams({ format: 'metadata', fields: 'threadId,payload(headers)' });
  for (const header of ['Subject', 'Message-ID', 'References']) query.append('metadataHeaders', header);
  const original = await gmailGet('messages/' + reply.messageId, query, token, fetcher);
  const header = name => original.payload?.headers?.find(item => item.name?.toLowerCase() === name)?.value;
  const sourceId = header('message-id')?.trim();
  if (original.threadId !== reply.threadId || !sourceId || sourceId.match(validMessageId)?.[0] !== sourceId) {
    throw badRequest('Open this conversation in Gmail to reply.');
  }
  const subject = (header('subject') ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, mailLimits.subject);
  const references = (header('references')?.slice(-8000).match(validMessageId) ?? []).slice(-15).filter(id => id !== sourceId);
  return {
    subject: /^re:/i.test(subject) ? subject : 'Re: ' + subject,
    inReplyTo: sourceId, references: [...references, sourceId],
  };
}

export async function buildGmailMessage(token, from, mail, fetcher = fetch) {
  const reply = mail.reply ? await replyEnvelope(token, mail.reply, fetcher) : {};
  const message = new MailComposer({
    from: { address: from }, to: mail.to.map(address => ({ address })), cc: mail.cc.map(address => ({ address })),
    bcc: mail.bcc.map(address => ({ address })), subject: mail.subject, text: mail.text,
    attachments: mail.attachments, disableFileAccess: true, disableUrlAccess: true, ...reply,
  }).compile();
  // Gmail needs the Bcc envelope in the submitted MIME. Gmail handles delivery.
  message.keepBcc = true;
  return { raw: (await message.build()).toString('base64url'), ...(mail.reply ? { threadId: mail.reply.threadId } : {}) };
}

export async function sendGmailMessage(token, message, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(new URL('messages/send', gmailBase), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(15_000),
    });
  } catch { throw uncertain(); }
  if (response.status === 401) throw reconnectGmail();
  if (response.status === 429) throw rejected('Gmail is busy or you reached its sending limit. Try again later.', 429);
  if (response.status >= 500) throw uncertain();
  const result = await readLimitedJson(response, 24_000).catch(() => ({}));
  if (response.status === 403) {
    const reasons = [...(result.error?.errors ?? []), ...(result.error?.details ?? [])].map(error => error?.reason);
    if (reasons.some(reason => ['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'].includes(reason))) throw gmailSendAccess();
    throw rejected('Gmail blocked this send. Check your Gmail account or try sending from Gmail.', 403);
  }
  if (!response.ok) throw rejected('Gmail rejected the message. Check the recipients and attachment types.', 400);
  if (!gmailResourceId.test(result.id ?? '') || !gmailResourceId.test(result.threadId ?? '')) throw uncertain();
  return { id: result.id, threadId: result.threadId };
}

// One bounded record per linked mailbox prevents repeat delivery across tabs and function instances.
async function updateAttempts(key, read, write, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await read(key);
    const { next, result } = change(current.data?.attempts ?? []);
    if (!next) return result;
    try {
      await write(key, { attempts: next }, current.revision);
      return result;
    } catch (error) {
      if (error.status !== 409) throw error;
    }
  }
  throw Object.assign(new Error('Email is busy. Wait a moment before trying again.'), { status: 409 });
}

export async function sendOnce({ key, mail, now, read, write, deliver }) {
  const previous = await updateAttempts(key, read, write, all => {
    const attempts = all.filter(entry => entry.at > now - day);
    const entry = attempts.find(item => item.id === mail.requestId);
    if (entry) {
      if (entry.fingerprint !== mail.fingerprint) throw uncertain();
      if (entry.sent) return { result: entry.sent };
      if (!entry.rejected) throw uncertain();
      throw rejected('Gmail rejected that attempt. Check the message before trying again.', 400);
    }
    if (attempts.length >= 100 || attempts.filter(item => item.at > now - 60_000).length >= 10) {
      throw Object.assign(new Error('The workspace sending limit was reached. Try again later or open Gmail.'), { status: 429 });
    }
    return { next: [...attempts, { id: mail.requestId, fingerprint: mail.fingerprint, at: now }] };
  });
  if (previous) return previous;

  const finish = update => updateAttempts(key, read, write, all => ({
    next: all.map(entry => entry.id === mail.requestId ? { ...entry, ...update } : entry),
  }));
  let sent;
  try { sent = await deliver(); }
  catch (error) {
    if (['gmail-send-rejected', 'gmail-send-access', 'gmail-reconnect'].includes(error.code)) {
      await finish({ rejected: true }).catch(() => {});
    }
    throw error;
  }
  // The Gmail receipt remains authoritative if recording it fails. The reservation still blocks retries.
  await finish({ sent }).catch(() => {});
  return sent;
}
