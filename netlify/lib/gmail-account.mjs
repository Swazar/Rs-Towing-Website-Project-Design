import { createHash, randomBytes } from 'node:crypto';
import { deployContext, isLocalPreview } from './store.mjs';

export const gmailCallbackPath = '/.netlify/functions/workspace-email';
export const gmailLinkLifetime = 600;
export const gmailReadScope = 'https://www.googleapis.com/auth/gmail.readonly';
export const gmailSendScope = 'https://www.googleapis.com/auth/gmail.send';
const tokenUrl = 'https://oauth2.googleapis.com/token';
export const digest = value => createHash('sha256').update(value).digest('base64url');
const randomValue = () => randomBytes(32).toString('base64url');

export function gmailConfig(request, env = process.env) {
  const local = isLocalPreview(request, env);
  if (!local && (env.NETLIFY_DEV === 'true' || deployContext(env) !== 'production')) return null;
  const origin = new URL(request.url).origin;
  if (origin !== env.RS_GMAIL_ORIGIN?.trim() || (!local && !origin.startsWith('https://'))) return null;
  const clientId = env.RS_GMAIL_CLIENT_ID?.trim();
  const clientSecret = env.RS_GMAIL_CLIENT_SECRET?.trim();
  const key = env.RS_GMAIL_TOKEN_KEY?.trim();
  const tokenKey = /^[A-Za-z0-9_-]{43}$/.test(key ?? '') ? Buffer.from(key, 'base64url') : null;
  return clientId && clientSecret ? {
    clientId, clientSecret, redirectUri: origin + gmailCallbackPath, ...(tokenKey?.length === 32 ? { tokenKey } : {}),
  } : null;
}

export function newGmailLink(config, now = Date.now(), { inbox = false, send = false, email } = {}) {
  const state = randomValue();
  const verifier = randomValue();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  const scopes = ['openid', 'email', ...(inbox ? [gmailReadScope] : []), ...(send ? [gmailSendScope] : [])];
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
    scope: scopes.join(' '),
    prompt: inbox ? 'select_account consent' : 'select_account', access_type: inbox ? 'offline' : 'online',
    state, code_challenge: digest(verifier), code_challenge_method: 'S256',
  }).toString();
  if (email) url.searchParams.set('login_hint', email);
  if (send) url.searchParams.set('include_granted_scopes', 'true');
  return {
    url: url.href,
    state,
    pending: { stateHash: digest(state), verifier, expiresAt: now + gmailLinkLifetime * 1000, inbox, ...(send ? { send } : {}) },
  };
}

async function exchangeToken(config, grant, fetcher) {
  return fetcher(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret, ...grant,
    }),
    signal: AbortSignal.timeout(5_000),
  });
}

const healthyToken = value => typeof value === 'string' && /^[A-Za-z0-9._~+/-]{1,8192}={0,2}$/.test(value);

async function googleIdentity(token, fetcher) {
  const userResponse = await fetcher('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(5_000),
  });
  if (!userResponse.ok) throw new Error('Google email address could not be verified.');
  const { sub, email, email_verified: verified, hd } = await userResponse.json();
  const hosted = typeof hd === 'string' && typeof email === 'string' && email.toLowerCase().endsWith('@' + hd.toLowerCase());
  if (typeof sub !== 'string' || !sub || sub.length > 255 || verified !== true ||
      typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) {
    throw new Error('Google email address could not be verified.');
  }
  if (!hosted && !/@(?:gmail|googlemail)\.com$/i.test(email)) {
    throw Object.assign(new Error('Choose a Gmail or Google Workspace account.'), { status: 422 });
  }
  return { subject: sub, email };
}

async function authorize(config, code, verifier, fetcher) {
  const response = await exchangeToken(config, {
    code, redirect_uri: config.redirectUri, code_verifier: verifier, grant_type: 'authorization_code',
  }, fetcher);
  if (!response.ok) throw new Error('Google sign-in could not be verified.');
  const tokens = await response.json();
  if (!healthyToken(tokens.access_token)) throw new Error('Google sign-in could not be verified.');
  return tokens;
}

export async function verifyGoogleEmail(config, code, verifier, fetcher = fetch) {
  const tokens = await authorize(config, code, verifier, fetcher);
  return googleIdentity(tokens.access_token, fetcher);
}

export async function authorizeGmailInbox(config, code, verifier, fetcher = fetch) {
  const tokens = await authorize(config, code, verifier, fetcher);
  const scopes = typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : [];
  if (!scopes.includes(gmailReadScope) || !healthyToken(tokens.refresh_token)) {
    throw Object.assign(new Error('Allow read-only access to enable the inbox.'), { status: 412 });
  }
  return { account: await googleIdentity(tokens.access_token, fetcher), refreshToken: tokens.refresh_token, canSend: scopes.includes(gmailSendScope) };
}

export function reconnectGmail() {
  return Object.assign(new Error('Reconnect Gmail to continue.'), { status: 409, code: 'gmail-reconnect' });
}

export function gmailSendAccess() {
  return Object.assign(new Error('Enable sending for this Gmail account to continue.'), { status: 409, code: 'gmail-send-access' });
}

export async function refreshGmailAccess(config, refreshToken, fetcher = fetch, send = false) {
  const response = await exchangeToken(config, { refresh_token: refreshToken, grant_type: 'refresh_token' }, fetcher);
  const result = await response.json().catch(() => ({}));
  const scopes = typeof result.scope === 'string' ? result.scope.split(/\s+/) : null;
  if (result.error === 'invalid_grant' || (scopes && !scopes.includes(gmailReadScope))) throw reconnectGmail();
  if (send && scopes && !scopes.includes(gmailSendScope)) throw gmailSendAccess();
  if (response.status === 429) throw Object.assign(new Error('Gmail is busy. Try again shortly.'), { status: 429 });
  if (!response.ok || !healthyToken(result.access_token)) throw new Error('Google did not return an access token.');
  return result.access_token;
}

export async function revokeGmailAccess(token, fetcher = fetch) {
  const response = await fetcher('https://oauth2.googleapis.com/revoke', {
    method: 'POST', body: new URLSearchParams({ token }), signal: AbortSignal.timeout(5_000),
  });
  if (response.ok) return true;
  const result = await response.json().catch(() => ({}));
  return result.error === 'invalid_token';
}
