import { admin, getUser } from '@netlify/identity';
import { isLocalPreview } from './store.mjs';
import { permissionsFor } from './owner-access.mjs';
import { checkWorkspaceSession } from './workspace-session.mjs';

export async function requireIdentityUser(request) {
  if (isLocalPreview(request)) return { id: 'local-preview', email: 'Local preview', roles: ['owner'] };
  const user = await getUser();
  if (!user) throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
  if (!permissionsFor(user).length) throw Object.assign(new Error('This account does not have workspace access.'), { status: 403 });
  return user;
}

export async function loadIdentitySignIn(user, getIdentityUser = admin.getUser) {
  // Recheck the authenticated account when its initial profile could not open a
  // workspace session. A token refresh does not count as a login.
  const current = await getIdentityUser(user.id);
  if (current?.id !== user.id || !permissionsFor(current).length) {
    throw Object.assign(new Error('This account does not have workspace access.'), { status: 403 });
  }
  return current;
}

export async function requireWorkspaceUser(request) {
  const user = await requireIdentityUser(request);
  await checkWorkspaceSession(request, user);
  return user;
}
