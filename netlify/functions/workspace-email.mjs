import { requireWorkspaceUser } from '../lib/workspace-user.mjs';
import { permissionsFor } from '../lib/owner-access.mjs';
import { json, readRecord, sameOrigin, writeRecord } from '../lib/store.mjs';
import { authorizeGmailInbox, digest, gmailConfig, gmailLinkLifetime, gmailSendAccess, newGmailLink, refreshGmailAccess, revokeGmailAccess, verifyGoogleEmail } from '../lib/gmail-account.mjs';
import { openGmailToken, protectGmailToken } from '../lib/gmail-token.mjs';
import { conversationId, inboxQuery, listGmailThreads, readGmailThread, readLimitedJson } from '../lib/gmail-inbox.mjs';
import { buildGmailMessage, outgoingMail, sendBodyLimit, sendGmailMessage, sendOnce } from '../lib/gmail-send.mjs';
import { clearSentDraft, draftMailbox, loadMailDraft, saveMailDraft } from '../lib/gmail-draft.mjs';

export const config = { rateLimit: { action: 'rate_limit', windowLimit: 45, windowSize: 60, aggregateBy: ['ip', 'domain'] } };

const validState = /^[A-Za-z0-9_-]{43}$/;

function stateCookie(request, state = '') {
  const secure = new URL(request.url).protocol === 'https:';
  const name = secure ? '__Host-rs_gmail_link' : 'rs_gmail_link';
  return {
    name,
    header: `${name}=${state}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${state ? gmailLinkLifetime : 0}`,
  };
}

function callbackResult(request, status) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/admin/?email-status=' + status + '#email',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Set-Cookie': stateCookie(request).header,
    },
  });
}

function linkStatus(data, settings, binding) {
  const account = data?.account;
  return {
    available: Boolean(settings), account: account ? { email: account.email } : null,
    ...(settings?.tokenKey ? { inboxAvailable: true, inboxConnected: Boolean(account && data?.grant) } : {}),
    ...(settings?.tokenKey && account && data?.grant && data.canSend === true ? { sendConnected: true, ...(binding ? { draftMailbox: draftMailbox(binding) } : {}) } : {}),
  };
}

async function requestBody(request, sending = false) {
  try { return await readLimitedJson(request, sending ? sendBodyLimit : 4096,
    sending ? 'This email is too large. Attach up to 3 MB total.' : 'This request is too large.'); }
  catch (error) {
    if (error instanceof SyntaxError) throw Object.assign(new Error('Check the request and try again.'), { status: 400 });
    throw error;
  }
}

export function createWorkspaceEmail({
  authenticate = requireWorkspaceUser, settingsFor = gmailConfig, read = readRecord,
  write = writeRecord, verify = verifyGoogleEmail, now = Date.now,
  permitInbox = authorizeGmailInbox, renew = refreshGmailAccess, revoke = revokeGmailAccess,
  list = listGmailThreads, open = readGmailThread, build = buildGmailMessage, send = sendGmailMessage,
} = {}) {
  return async function workspaceEmail(request) {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const callback = request.method === 'GET' && action === null;
    if (!callback && !(['status', 'draft'].includes(action) && request.method === 'GET' ||
      ['connect', 'disconnect', 'enable-inbox', 'enable-send', 'inbox', 'thread', 'send', 'draft'].includes(action) && request.method === 'POST')) {
      return json({ error: 'This email action is unavailable.' }, 405);
    }
    try {
      if (request.method === 'POST') sameOrigin(request);
      const user = await authenticate(request);
      if (!permissionsFor(user).includes('email')) return callback ? callbackResult(request, 'expired') : json({ error: 'Only an owner can manage email.' }, 403);
      const key = 'gmail-account/' + digest(user.id);
      const settings = settingsFor(request);
      const current = await read(key);
      const account = current.data?.account;
      const grant = current.data?.grant;
      const binding = account && key + '/' + account.subject;
      const drafts = { tokenKey: settings?.tokenKey, binding, read, write, now };
      const matchesMailbox = value => Boolean(binding && value === draftMailbox(binding));
      const accountChanged = () => json({ error: 'The linked Gmail account changed. Reload Email before continuing.', code: 'gmail-draft-account' }, 409);
      if (action === 'status') return json(linkStatus(current.data, settings, binding));
      if (action === 'draft') {
        if (!settings?.tokenKey || !account || !grant) return accountChanged();
        if (request.method === 'GET') {
          return matchesMailbox(searchParams.get('mailbox')) ? json(await loadMailDraft(drafts)) : accountChanged();
        }
        const body = await requestBody(request, true);
        return matchesMailbox(body?.mailbox) ? json(await saveMailDraft(drafts, body)) : accountChanged();
      }
      if (action === 'inbox' || action === 'thread' || action === 'send') {
        const sending = action === 'send';
        if (!settings?.tokenKey || !grant || !account) return json({ error: 'Reconnect the Gmail inbox to continue.', code: 'gmail-reconnect' }, 409);
        if (sending && current.data.canSend !== true) throw gmailSendAccess();
        const body = await requestBody(request, sending);
        const input = sending ? outgoingMail(body) : action === 'inbox' ? inboxQuery(body) : conversationId(body);
        const savedAttempt = sending && body.mailbox !== undefined;
        if (savedAttempt) {
          if (!matchesMailbox(body.mailbox)) return accountChanged();
          const draft = await loadMailDraft(drafts);
          if (draft.data?.attempt?.id === input.requestId && now() - draft.data.attempt.at >= 24 * 60 * 60_000) {
            return json({ error: 'Check Gmail Sent. This delivery attempt is too old to retry safely.', code: 'gmail-send-unknown' }, 409);
          }
        }
        const refresh = () => renew(settings, openGmailToken(settings.tokenKey, binding, grant), undefined, sending);
        if (sending) {
          try {
            const accessToken = await refresh();
            const message = await build(accessToken, account.email, input);
            const result = await sendOnce({
              key: 'gmail-send/' + digest(binding), mail: input, now: now(), read, write,
              deliver: () => send(accessToken, message),
            });
            if (savedAttempt) await clearSentDraft(drafts, input.requestId).catch(() => {});
            return json(result);
          } catch (error) {
            if (error.code === 'gmail-send-access') {
              await write(key, { ...current.data, canSend: false }, current.revision).catch(() => {});
            }
            throw error;
          }
        }
        const accessToken = await refresh();
        return json(action === 'inbox' ? await list(accessToken, input) : await open(accessToken, input));
      }
      if (action === 'disconnect') {
        await write(key, null, current.revision);
        let revokeFailed = false;
        if (account && grant) {
          try { revokeFailed = !await revoke(openGmailToken(settings?.tokenKey, binding, grant)); }
          catch { revokeFailed = true; }
        }
        const response = json({ ...linkStatus(null, settings), ...(revokeFailed ? { revokeFailed } : {}) });
        response.headers.set('Set-Cookie', stateCookie(request).header);
        return response;
      }
      if (action === 'connect' || action === 'enable-inbox' || action === 'enable-send') {
        if (!settings) return json({ error: 'Google connection setup is required.' }, 503);
        if (action !== 'connect' && !settings.tokenKey) return json({ error: 'Configure inbox access first.' }, 409);
        if (action === 'enable-send' && (!account || !grant)) return json({ error: 'Connect the Gmail inbox first.' }, 409);
        const link = newGmailLink(settings, now(), action === 'connect' ? undefined : {
          inbox: true, send: action === 'enable-send', email: account?.email,
        });
        await write(key, { ...current.data, account: account ?? null, pending: link.pending }, current.revision);
        const response = json({ authorizationUrl: link.url });
        response.headers.set('Set-Cookie', stateCookie(request, link.state).header);
        return response;
      }

      const state = searchParams.get('state') ?? '';
      const { name } = stateCookie(request);
      const cookie = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim())
        .find(part => part.startsWith(name + '='))?.slice(name.length + 1);
      const pending = current.data?.pending;
      if (!settings || !validState.test(state) || state !== cookie || !pending ||
          pending.expiresAt <= now() || pending.stateHash !== digest(state)) return callbackResult(request, 'expired');

      // Consume the attempt before contacting Google. A new link or disconnect wins over an older response.
      const consumed = await write(key, { ...current.data, pending: null }, current.revision);
      if (searchParams.get('error') === 'access_denied') return callbackResult(request, pending.send ? 'send-denied' : 'cancelled');
      const code = searchParams.get('code');
      if (!code || code.length > 4096 || searchParams.has('error')) return callbackResult(request, 'failed');
      if (pending.inbox) {
        if (!settings.tokenKey) return callbackResult(request, 'failed');
        const approved = await permitInbox(settings, code, pending.verifier).catch(error => {
          if (pending.send && error.status === 412) return null;
          throw error;
        });
        if (!approved || (pending.send && !approved.canSend)) return callbackResult(request, 'send-denied');
        if (account && approved.account.subject !== account.subject) return callbackResult(request, 'wrong-account');
        const encrypted = protectGmailToken(settings.tokenKey, key + '/' + approved.account.subject, approved.refreshToken);
        await write(key, { account: approved.account, pending: null, grant: encrypted, ...(approved.canSend ? { canSend: true } : {}) }, consumed.revision);
        return callbackResult(request, pending.send ? 'send-ready' : 'inbox-ready');
      }
      const verified = await verify(settings, code, pending.verifier);
      const preserved = grant && verified.subject === account?.subject ? { grant, ...(current.data.canSend ? { canSend: true } : {}) } : {};
      await write(key, { account: verified, pending: null, ...preserved }, consumed.revision);
      return callbackResult(request, 'linked');
    } catch (error) {
      if (callback) {
        const status = [401, 403, 409].includes(error.status) ? 'expired'
          : error.status === 422 ? 'gmail-required' : error.status === 412 ? 'inbox-denied' : 'failed';
        return callbackResult(request, status);
      }
      if ([400, 401, 403, 404, 409, 413, 424, 429].includes(error.status)) {
        return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
      }
      return json({ error: 'Email is temporarily unavailable. Try again in a moment.' }, 503);
    }
  };
}

export default createWorkspaceEmail();
