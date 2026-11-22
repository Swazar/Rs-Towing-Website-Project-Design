import { mailLimits } from '../../src/domain/mail/compose.ts';
import { digest } from './gmail-account.mjs';
import { mailAttachments, mailReply, validMailRequest } from './gmail-send.mjs';
import { openGmailToken, protectGmailToken } from './gmail-token.mjs';

export const draftMailbox = binding => digest('draft/' + binding);
const draftKey = binding => 'gmail-draft/' + draftMailbox(binding);
const limits = { to: 2000, cc: 2000, bcc: 2000, subject: mailLimits.subject, text: mailLimits.text };
const invalid = () => Object.assign(new Error('Check the saved draft fields.'), { status: 400 });
const revisionConflict = () => Object.assign(new Error('This draft changed in another tab. Keep this tab open to copy your edits before reloading.'), {
  status: 409, code: 'gmail-draft-conflict',
});

function readDraftRecord(tokenKey, binding, record) {
  if (!record.data) return null;
  try { return JSON.parse(openGmailToken(tokenKey, draftKey(binding), record.data)); }
  catch { throw Object.assign(new Error('This saved draft could not be opened.'), { status: 409, code: 'gmail-draft-unavailable' }); }
}

export async function loadMailDraft({ tokenKey, binding, read }) {
  const record = await read(draftKey(binding));
  return { data: readDraftRecord(tokenKey, binding, record), revision: record.revision };
}

export async function saveMailDraft({ tokenKey, binding, read, write, now }, body) {
  const key = draftKey(binding);
  if (body?.revision !== null && (typeof body?.revision !== 'string' || body.revision.length > 200)) throw invalid();
  const current = await read(key);
  if (current.revision !== body.revision) throw revisionConflict();
  let draft = null;
  if (body.draft !== null) {
    const input = body.draft;
    draft = {};
    for (const [field, limit] of Object.entries(limits)) {
      const value = input?.[field];
      if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw invalid();
      draft[field] = value;
    }
    mailAttachments(input.attachments);
    draft.attachments = input.attachments.map(({ name, data }) => ({ name, data }));
    const reply = mailReply(input.reply);
    if (reply) draft.reply = reply;
    if (input.attempt !== undefined) {
      const id = input.attempt?.id;
      if (typeof id !== 'string' || !validMailRequest.test(id)) throw invalid();
      const previous = readDraftRecord(tokenKey, binding, current)?.attempt;
      draft.attempt = { id, at: previous?.id === id ? previous.at : now() };
    }
  }
  if (!draft && !current.data) return { revision: current.revision };
  const encrypted = draft ? protectGmailToken(tokenKey, key, JSON.stringify(draft)) : null;
  try { return { revision: (await write(key, encrypted, current.revision)).revision }; }
  catch (error) { if (error.status === 409) throw revisionConflict(); throw error; }
}

export async function clearSentDraft({ tokenKey, binding, read, write }, requestId) {
  const key = draftKey(binding);
  const current = await read(key);
  if (readDraftRecord(tokenKey, binding, current)?.attempt?.id === requestId) {
    await write(key, null, current.revision);
  }
}
