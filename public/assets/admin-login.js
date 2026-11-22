export function clearLoginQuery(location, history) {
  const address = new URL(location.href);
  if (!address.searchParams.has('password') && !address.searchParams.has('identifier')) return;
  address.searchParams.delete('password');
  address.searchParams.delete('identifier');
  history.replaceState(history.state, '', address);
}

export function createAdminLogin({ api, completeAccess, googleSignIn, onSignedIn }) {
  const $ = selector => document.querySelector(selector);
  const form = $('#owner-login-form');
  const password = $('#owner-password');
  const identifier = $('#owner-email');
  const resetDialog = $('#owner-reset-dialog');
  let settingPassword = false, busy = false;

  function message(text = '', { tone = 'info', detail = '' } = {}, target = $('#login-status')) {
    target.textContent = [text, detail].filter(Boolean).join(' ');
    target.hidden = !target.textContent;
    target.dataset.tone = tone;
    target.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    target.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
  }

  async function submit(button, label, task, status) {
    if (busy) return;
    busy = true;
    const labelNode = button.querySelector('span') || button;
    const original = labelNode.textContent;
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    $('#owner-google').disabled = true;
    message('', {}, status);
    labelNode.textContent = label;
    try { await task(); }
    catch (error) { message(error.message || 'Unable to sign in. Please try again.', { tone: 'error' }, status); }
    finally {
      busy = false;
      button.disabled = false;
      $('#owner-google').disabled = false;
      labelNode.textContent = original;
      form.removeAttribute('aria-busy');
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit($('#owner-login-submit'), settingPassword ? 'Saving…' : 'Signing in…', async () => {
      if (settingPassword) {
        await completeAccess(password.value);
        location.reload();
        return;
      }
      await api('login', { identifier: identifier.value.trim(), password: password.value });
      form.reset();
      password.type = 'password';
      $('#owner-password-toggle').textContent = 'Show';
      $('#owner-password-toggle').setAttribute('aria-label', 'Show password');
      $('#owner-password-toggle').setAttribute('aria-pressed', 'false');
      await onSignedIn();
    });
  });
  $('#owner-login-submit').disabled = false;

  $('#owner-password-toggle').addEventListener('click', event => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    event.currentTarget.textContent = show ? 'Hide' : 'Show';
    event.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    event.currentTarget.setAttribute('aria-pressed', String(show));
  });

  $('#owner-google').addEventListener('click', () => {
    submit($('#owner-google'), 'Connecting…', googleSignIn);
  });

  $('#owner-recovery').addEventListener('click', () => {
    if (busy) return;
    $('#owner-reset-identifier').value = identifier.value;
    message('', {}, $('#owner-reset-status'));
    resetDialog.showModal();
    $('#owner-reset-identifier').focus();
  });
  $('#owner-reset-close').addEventListener('click', () => resetDialog.close());
  $('#owner-reset-form').addEventListener('submit', event => {
    event.preventDefault();
    const resetForm = event.currentTarget;
    if (!resetForm.reportValidity()) return;
    submit(resetForm.querySelector('[type="submit"]'), 'Sending…', async () => {
      await api('recovery', { identifier: $('#owner-reset-identifier').value.trim() });
      message('If this matches an invited account, a password reset link will arrive in its email inbox.', {}, $('#owner-reset-status'));
    }, $('#owner-reset-status'));
  });

  $('#login-year').textContent = String(new Date().getFullYear());
  return {
    message,
    setPasswordMode() {
      settingPassword = true;
      $('#login-title').textContent = 'Set your password';
      $('#login-intro').textContent = 'Choose a password of at least 12 characters.';
      identifier.required = false;
      identifier.disabled = true;
      identifier.closest('.field').hidden = true;
      password.autocomplete = 'new-password';
      password.minLength = 12;
      $('#owner-login-submit').textContent = 'Save password';
      $('#owner-google').hidden = true;
      $('#login-recovery-row').hidden = true;
    },
  };
}
