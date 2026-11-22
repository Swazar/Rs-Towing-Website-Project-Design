import { acceptInvite, getSettings, handleAuthCallback, oauthLogin, updateUser } from '@netlify/identity';

let callback;

export async function prepareOwnerAccess() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('error') || params.has('error_description')) {
    history.replaceState(null, '', location.pathname + location.search);
    throw new Error('Google sign-in was cancelled or could not be completed. Try again or use your email and password.');
  }
  callback = await handleAuthCallback();
  return callback?.type;
}

export async function completeOwnerAccess(password) {
  if (callback?.type === 'invite') await acceptInvite(callback.token, password);
  else await updateUser({ password });
  callback = undefined;
}

export async function signInWithGoogle() {
  let settings;
  try { settings = await getSettings(); }
  catch { throw new Error('Google sign-in is not available yet. Enable Google in Netlify Identity for the live website.'); }
  if (!settings.providers.google) throw new Error('Google sign-in is not enabled yet. Use your email or username and password.');
  try { oauthLogin('google'); }
  catch (error) {
    // The SDK deliberately throws after initiating navigation.
    if (error.message !== 'Redirecting to OAuth provider') throw error;
  }
}
