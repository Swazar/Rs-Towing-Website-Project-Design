// Identity may return to the homepage. Keep auth fragments in the browser and
// send them to the admin callback handler, never into a query string or a log.
(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const keys = ['access_token', 'invite_token', 'recovery_token', 'confirmation_token', 'email_change_token', 'error', 'error_description'];
  if (keys.some(key => params.has(key))) location.replace('/admin/' + location.hash);
})();
