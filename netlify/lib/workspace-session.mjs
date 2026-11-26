import { createHash, randomBytes } from 'node:crypto';
import { isLocalPreview, readRecord, writeRecord } from './store.mjs';

const cookieName = '__Host-rs_workspace';
const idleMs = 30 * 60_000;
const absoluteMs = 12 * 60 * 60_000;
const maxSessions = 8;
const signInWindowMs = 5 * 60_000;
const keyFor = user => 'workspace-session/' + createHash('sha256').update(user.id).digest('hex');
const expired = () => Object.assign(new Error('Your workspace session ended. Sign in again.'), { status: 401 });

function sessionId(request) {
  const raw = (request.headers.get('cookie') || '').match(/(?:^|;\s*)__Host-rs_workspace=([a-f0-9]{64})(?=;|$)/)?.[1];
  return raw && digest(raw);
}

const digest = value => createHash('sha256').update(value).digest('hex');
const expiresAt = session => Math.min(session.lastSeen + idleMs, session.started + absoluteMs);

export function workspaceCookie(token = '') {
  return `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${token ? absoluteMs / 1000 : 0}`;
}

export async function changeSessions(user, update, storage = { readRecord, writeRecord }) {
  const key = keyFor(user);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await storage.readRecord(key);
    const data = current.data ?? { entries: {}, latestLogin: 0 };
    const next = update(data);
    if (next === data) return;
    try {
      return await storage.writeRecord(key, next, current.revision);
    } catch (error) {
      if (error.status !== 409 || attempt === 3) throw error;
    }
  }
}

export async function recordIdentitySignIn(user, { now = Date.now(), storage } = {}) {
  await changeSessions(user, data => ({ ...data, identitySignIn: Math.max(data.identitySignIn ?? 0, now) }), storage);
}

export async function openWorkspaceSession(request, user, { freshIdentity = false, now = Date.now(), storage } = {}) {
  const profileSignIn = Date.parse(user.lastSignInAt) || 0;
  const token = randomBytes(32).toString('hex');
  const id = digest(token);
  const previousId = sessionId(request);
  await changeSessions(user, data => {
    const recentLogin = Math.max(profileSignIn <= now + 30_000 ? profileSignIn : 0, data.identitySignIn ?? 0);
    if (freshIdentity && (recentLogin < now - signInWindowMs || recentLogin > now + 30_000 || recentLogin <= data.latestLogin)) {
      throw Object.assign(new Error('Google verified your account, but the workspace could not confirm a fresh sign-in. Choose Login with Google to try again.'), {
        status: 401, code: 'WORKSPACE_SIGN_IN_FRESHNESS',
      });
    }
    const entries = Object.entries(data.entries)
      .filter(([key, session]) => key !== previousId && expiresAt(session) > now)
      .sort(([, a], [, b]) => b.lastSeen - a.lastSeen).slice(0, maxSessions - 1);
    entries.push([id, { started: now, lastSeen: now }]);
    return { entries: Object.fromEntries(entries), latestLogin: Math.max(data.latestLogin, recentLogin, freshIdentity ? 0 : now) };
  }, storage);
  return token;
}

export async function checkWorkspaceSession(request, user, { touch = false, now = Date.now(), storage = { readRecord, writeRecord } } = {}) {
  if (isLocalPreview(request)) return null;
  const id = sessionId(request);
  if (!id) throw expired();
  const current = (await storage.readRecord(keyFor(user))).data?.entries[id];
  if (!current || expiresAt(current) <= now) throw expired();
  if (!touch) return expiresAt(current);
  let deadline;
  await changeSessions(user, data => {
    const session = data.entries[id];
    if (!session || expiresAt(session) <= now) throw expired();
    const lastSeen = Math.max(session.lastSeen, now);
    deadline = expiresAt({ ...session, lastSeen });
    if (lastSeen - session.lastSeen < 30_000) {
      deadline = expiresAt(session);
      return data;
    }
    return { ...data, entries: { ...data.entries, [id]: { ...session, lastSeen } } };
  }, storage);
  return deadline;
}

export async function closeWorkspaceSession(request, user) {
  const id = sessionId(request);
  if (!id || !user?.id) return;
  await changeSessions(user, data => {
    if (!data.entries[id]) return data;
    const entries = { ...data.entries };
    delete entries[id];
    return { ...data, entries };
  });
}
