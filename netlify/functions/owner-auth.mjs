import { login, logout, requestPasswordRecovery } from '@netlify/identity';
import { resolveLoginEmail } from '../lib/login-identifier.mjs';
import { permissionsFor } from '../lib/owner-access.mjs';
import { openWorkspaceSession, workspaceCookie } from '../lib/workspace-session.mjs';
import { json, sameOrigin } from '../lib/store.mjs';
import { text } from '../lib/validation.mjs';

export const config = { rateLimit: { action: 'rate_limit', windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] } };

export function createAuthHandler(openSession = openWorkspaceSession) {
  return async function ownerAuth(request) {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    try {
      sameOrigin(request);
      const raw = await request.text();
      if (raw.length > 4000) return json({ error: 'Request too large.' }, 413);
      const body = JSON.parse(raw);
      const action = new URL(request.url).searchParams.get('action');
      if (action === 'recovery') {
        const email = resolveLoginEmail(body?.identifier);
        if (email) {
          try { await requestPasswordRecovery(email); }
          catch (error) { if (![400, 404, 422].includes(error.status)) throw error; }
        }
        return json({ sent: true });
      }
      if (action !== 'login') return json({ error: 'Not found.' }, 404);
      const email = resolveLoginEmail(body?.identifier ?? body?.email);
      const invalid = () => json({ error: 'Check your email or username and password.' }, 401);
      if (!email || typeof body.password !== 'string' || !body.password.trim()) return invalid();
      text(body.password, 200, 'password', true);
      let user;
      try { user = await login(email, body.password); }
      catch (error) { if ([400, 401, 403].includes(error.status)) return invalid(); throw error; }
      if (!permissionsFor(user).length) {
        await logout();
        return json({ error: 'This account does not have owner access.' }, 403);
      }
      const token = await openSession(request, user);
      const response = json({ signedIn: true });
      response.headers.append('Set-Cookie', workspaceCookie(token));
      return response;
    } catch (error) {
      if (error instanceof SyntaxError) return json({ error: 'Check the submitted details.' }, 400);
      return json({ error: error.status === 403 ? error.message : error.status === 400 ? error.message : 'Sign-in is temporarily unavailable. Try again shortly.' }, error.status ?? 503);
    }
  };
}

export default createAuthHandler();
