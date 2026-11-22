import { WorkspaceInbox, type InboxApi } from './gmail-inbox.ts';
import { GmailComposer } from './gmail-compose.ts';
import type { ComposerDraft, OutgoingMail, SavedMailDraft, SentMail } from '../domain/mail/compose.ts';

type EmailStatus = { available: boolean; account: { email: string } | null; inboxAvailable?: boolean; inboxConnected?: boolean; sendConnected?: boolean; draftMailbox?: string; revokeFailed?: boolean };
type EmailResults = {
  'email-status': EmailStatus;
  'email-connect': { authorizationUrl: string };
  'email-enable-inbox': { authorizationUrl: string };
  'email-enable-send': { authorizationUrl: string };
  'email-disconnect': EmailStatus;
};
type EmailApi = InboxApi & ((action: 'email-send', data: OutgoingMail) => Promise<SentMail>) &
  ((action: 'email-draft', data: undefined, query: { mailbox: string }) => Promise<SavedMailDraft>) &
  ((action: 'email-draft', data: { mailbox: string; revision: string | null; draft: ComposerDraft | null }) => Promise<{ revision: string | null }>) &
  (<Action extends keyof EmailResults>(action: Action, data?: Record<string, never>) => Promise<EmailResults[Action]>);

const callbackMessages: Record<string, string> = {
  linked: 'Gmail account linked.',
  'inbox-ready': 'Read-only inbox connected.',
  'inbox-denied': 'Allow read-only Gmail access at Google to enable the inbox.',
  'send-ready': 'Gmail is ready to send messages.',
  'send-denied': 'Sending access was not granted. You can still read your inbox.',
  'wrong-account': 'Choose the Gmail account shown on this page.',
  cancelled: 'Google connection was cancelled.',
  expired: 'This connection attempt expired. Start again when you’re ready.',
  'gmail-required': 'Choose a Gmail or Google Workspace account.',
  failed: 'Google could not link the account. Try again.',
};

const imagePreferenceKey = (email: string) => 'rs-gmail-images:' + email.toLowerCase();

export class WorkspaceEmail {
  private readonly api: EmailApi;
  private readonly window: Window;
  private readonly description: HTMLElement;
  private readonly message: HTMLElement;
  private readonly connect: HTMLButtonElement;
  private readonly disconnect: HTMLButtonElement;
  private readonly enableInbox: HTMLButtonElement;
  private readonly accessNote: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly inbox: HTMLAnchorElement;
  private readonly setupInbox: HTMLAnchorElement;
  private readonly setup: HTMLElement;
  private readonly setupTitle: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly accountMenu: HTMLDetailsElement;
  private readonly accountAddress: HTMLElement;
  private readonly accountInitial: HTMLElement;
  private readonly accountAccess: HTMLElement;
  private readonly imageSetting: HTMLElement;
  private readonly automaticImages: HTMLInputElement;
  private readonly mailbox: WorkspaceInbox;
  private readonly compose: HTMLButtonElement;
  private readonly composer: GmailComposer;
  private active = false;
  private busy = false;
  private version = 0;
  private status: EmailStatus | undefined;

  constructor(root: HTMLElement, api: EmailApi) {
    this.api = api;
    this.window = root.ownerDocument.defaultView!;
    this.description = root.querySelector<HTMLElement>('#gmail-description')!;
    this.message = root.querySelector<HTMLElement>('#gmail-feedback')!;
    this.connect = root.querySelector<HTMLButtonElement>('#gmail-connect')!;
    this.disconnect = root.querySelector<HTMLButtonElement>('#gmail-disconnect')!;
    this.enableInbox = root.querySelector<HTMLButtonElement>('#gmail-enable-inbox')!;
    this.accessNote = root.querySelector<HTMLElement>('#gmail-access-note')!;
    this.retry = root.querySelector<HTMLButtonElement>('#gmail-retry')!;
    this.inbox = root.querySelector<HTMLAnchorElement>('#gmail-inbox')!;
    this.setupInbox = root.querySelector<HTMLAnchorElement>('#gmail-setup-gmail')!;
    this.setup = root.querySelector<HTMLElement>('#gmail-setup')!;
    this.setupTitle = root.querySelector<HTMLElement>('#gmail-heading')!;
    this.toolbar = root.querySelector<HTMLElement>('#gmail-topbar')!;
    this.accountMenu = root.querySelector<HTMLDetailsElement>('#gmail-account-menu')!;
    this.accountAddress = root.querySelector<HTMLElement>('#gmail-account-address')!;
    this.accountInitial = root.querySelector<HTMLElement>('#gmail-account-initial')!;
    this.accountAccess = root.querySelector<HTMLElement>('#gmail-account-access')!;
    this.imageSetting = root.querySelector<HTMLElement>('#gmail-image-setting')!;
    this.automaticImages = root.querySelector<HTMLInputElement>('#gmail-automatic-images')!;
    this.compose = root.querySelector<HTMLButtonElement>('#gmail-compose')!;
    this.mailbox = new WorkspaceInbox(root, api, () => {
      if (this.status) this.render({ ...this.status, inboxConnected: false, sendConnected: false });
      this.enableInbox.textContent = 'Reconnect inbox';
      this.message.textContent = 'Gmail access expired or was revoked. Reconnect to view messages.';
      this.enableInbox.focus();
    }, draft => { void this.composer.open(draft); });
    this.composer = new GmailComposer(root, mail => this.api('email-send', mail), (result, reply) => {
      const link = root.ownerDocument.createElement('a');
      const target = new URL(this.inbox.href);
      target.hash = 'sent/' + encodeURIComponent(result.threadId);
      link.href = target.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'View in Gmail';
      this.message.replaceChildren('Sent through Gmail. ', link);
      if (this.active) this.mailbox.refreshAfterSend(reply);
    }, code => {
      if (!this.status) return;
      this.render({ ...this.status, sendConnected: false,
        ...(code === 'gmail-reconnect' ? { inboxConnected: false } : {}) });
      this.message.textContent = code === 'gmail-reconnect'
        ? 'Reconnect Gmail to send messages.' : 'Enable sending again to send messages.';
    }, {
      load: mailbox => this.api('email-draft', undefined, { mailbox }),
      save: (mailbox, revision, draft) => this.api('email-draft', { mailbox, revision, draft }),
    });
    this.compose.addEventListener('click', () => {
      if (this.status?.sendConnected) void this.composer.open();
      else void this.change('email-enable-send');
    });
    this.connect.addEventListener('click', () => void this.change('email-connect'));
    this.disconnect.addEventListener('click', () => void this.change('email-disconnect'));
    this.enableInbox.addEventListener('click', () => void this.change('email-enable-inbox'));
    this.retry.addEventListener('click', () => void this.load());
    this.automaticImages.addEventListener('change', () => {
      const email = this.status?.account?.email;
      if (!email || !this.active || !this.status?.inboxConnected) return;
      const enabled = this.automaticImages.checked;
      this.mailbox.setAutomaticImages(enabled);
      try {
        const key = imagePreferenceKey(email);
        if (enabled) this.window.localStorage.removeItem(key);
        else this.window.localStorage.setItem(key, '0');
      } catch {
        this.message.textContent = 'Your image setting applies until you reload this page.';
      }
    });
    this.window.addEventListener('storage', event => {
      const email = this.status?.account?.email;
      if (email && this.active && this.status?.inboxConnected && (event.key === null || event.key === imagePreferenceKey(email))) {
        this.applyImagePreference(email);
      }
    });
    root.ownerDocument.addEventListener('click', event => {
      if (this.accountMenu.open && !this.accountMenu.contains(event.target as Node)) this.accountMenu.open = false;
    });
    this.accountMenu.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !this.accountMenu.open) return;
      this.accountMenu.open = false;
      this.accountMenu.querySelector<HTMLElement>('summary')?.focus();
    });
    this.window.addEventListener('pageshow', event => {
      if (!event.persisted || !this.active) return;
      this.setBusy(false);
      void this.load();
    });
  }

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (active) void this.load();
    else {
      this.accountMenu.open = false;
      this.composer.dismiss();
      this.mailbox.setAccount();
    }
  }

  reset() {
    this.active = false;
    this.version++;
    this.setBusy(false);
    this.render();
    this.message.textContent = '';
  }

  private applyImagePreference(email?: string) {
    let enabled = Boolean(email);
    try {
      if (email && this.window.localStorage.getItem(imagePreferenceKey(email)) === '0') enabled = false;
    } catch { /* Browsers can disable persistent storage. */ }
    this.automaticImages.checked = enabled;
    this.mailbox.setAutomaticImages(enabled);
  }

  private render(status?: EmailStatus) {
    this.status = status;
    const email = status?.account?.email;
    const connected = Boolean(email && status?.inboxConnected);
    const sending = connected && Boolean(status?.sendConnected);
    this.setup.hidden = connected;
    this.toolbar.hidden = !email;
    this.setupTitle.textContent = email ? 'Set up your inbox' : 'Connect Gmail';
    this.description.textContent = email ? 'Linked to ' + email
      : status?.available ? 'Choose the Google account you use for business email.'
        : status ? 'Google connection setup is required. You can still open Gmail.' : 'Checking connection…';
    this.accountAddress.textContent = email || '';
    this.accountInitial.textContent = email?.[0].toLocaleUpperCase() || '';
    this.accountAccess.textContent = sending ? 'Read and send access' : connected ? 'Read-only access' : 'Account linked';
    this.compose.hidden = !connected;
    this.compose.querySelector('span')!.textContent = sending ? 'Compose' : 'Enable sending';
    this.composer.setAccount(email, sending, status?.draftMailbox);
    this.imageSetting.hidden = !connected;
    if (!email) this.accountMenu.open = false;
    const inboxUrl = new URL('https://mail.google.com/mail/');
    if (email) inboxUrl.searchParams.set('authuser', email);
    this.inbox.href = this.setupInbox.href = inboxUrl.href;
    this.connect.hidden = !status?.available || Boolean(email) || Boolean(status?.inboxAvailable);
    this.disconnect.hidden = !email;
    this.enableInbox.hidden = !status?.inboxAvailable || Boolean(status?.inboxConnected);
    this.enableInbox.textContent = email ? 'Enable read-only inbox' : 'Connect Gmail inbox';
    this.accessNote.hidden = Boolean(status?.inboxConnected);
    this.accessNote.textContent = !email ? status?.inboxAvailable
      ? 'Connect a Gmail account to view conversations with read-only access.' : 'Link your Gmail account to get started.'
      : status?.inboxAvailable ? 'Allow read-only access to view conversations here.'
        : 'Inbox access needs server setup. You can view your messages in Gmail.';
    this.mailbox.setAccount(this.active && status?.inboxConnected ? email : undefined);
    this.mailbox.setReplyEnabled(sending);
    this.applyImagePreference(connected ? email : undefined);
  }

  private setBusy(busy: boolean) {
    this.busy = busy;
    this.connect.disabled = this.disconnect.disabled = this.enableInbox.disabled = this.retry.disabled = busy;
    this.compose.disabled = busy;
  }

  private async load() {
    if (this.busy) return;
    const version = this.version;
    this.retry.hidden = true;
    this.setBusy(true);
    const url = new URL(this.window.location.href);
    const callback = url.searchParams.get('email-status');
    if (callback !== null) {
      url.searchParams.delete('email-status');
      this.window.history.replaceState(null, '', url);
    }
    this.message.textContent = callback && Object.hasOwn(callbackMessages, callback) ? callbackMessages[callback] : '';
    try {
      const status = await this.api('email-status');
      if (version === this.version) this.render(status);
    } catch {
      if (version !== this.version) return;
      this.description.textContent = 'Could not check the Gmail connection.';
      this.retry.hidden = false;
    } finally {
      if (version === this.version) this.setBusy(false);
    }
  }

  private async change(action: 'email-connect' | 'email-enable-inbox' | 'email-enable-send' | 'email-disconnect') {
    if (this.busy || !this.active) return;
    const version = this.version;
    this.setBusy(true);
    this.message.textContent = action === 'email-disconnect' ? 'Disconnecting…' : 'Opening Google…';
    let leaving = false;
    try {
      if (action !== 'email-disconnect') {
        const { authorizationUrl } = await this.api(action, {});
        if (version !== this.version || !this.active) return;
        const target = new URL(authorizationUrl);
        if (target.origin !== 'https://accounts.google.com' || target.pathname !== '/o/oauth2/v2/auth') throw new Error('Google sign-in could not be opened.');
        this.window.location.assign(target.href);
        leaving = true;
      } else {
        const result = await this.api(action, {});
        if (version !== this.version) return;
        this.render(result);
        this.message.textContent = result.revokeFailed
          ? 'Disconnected here. To remove the grant in Google, open your Google Account connections.'
          : 'Gmail account disconnected.';
        if (this.active) this.setupInbox.focus();
      }
    } catch (error) {
      if (version !== this.version) return;
      this.message.textContent = error instanceof Error && error.message || 'Could not update the Gmail connection. Try again.';
    } finally {
      if (version === this.version && !leaving) this.setBusy(false);
    }
  }
}
