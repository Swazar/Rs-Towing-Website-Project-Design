import { initials } from '../../public/assets/admin-ui.js';
import type { FormattedMail, MailAttachment, MailContent } from '../domain/mail/content.ts';
import { mailAttachments, mailFormattedView, mailReadingBody, mailVisualPreview, originalMailLink } from './gmail-reading.ts';
import { mailAddress, mailLimits, type MailReply } from '../domain/mail/compose.ts';
import type { ReplyDraft } from './gmail-compose.ts';

const folderNames = { inbox: 'Inbox', unread: 'Unread', read: 'Read', starred: 'Starred', sent: 'Sent', attachments: 'Attachments', all: 'All mail' };
type MailFolder = keyof typeof folderNames;
const inboxViews = new Set<MailFolder>(['inbox', 'unread', 'read']);
type Summary = { id: string; subject: string; from: string; recipient?: string; at: number | null; unread: boolean; snippet: string };
type Message = {
  id: string; from: string; to: string; at: number | null; body: string; previewOnly: boolean;
  cc?: string; replyTo?: string; content?: MailContent[]; attachments?: MailAttachment[];
  formatted?: FormattedMail;
  visualPreview?: { summary: string };
};
type InboxPage = { threads: Summary[]; nextPage: string | null };
type Conversation = { id: string; subject: string; earlier: number; messages: Message[] };

type InboxResults = { 'email-inbox': InboxPage; 'email-thread': Conversation };
type InboxInputs = { 'email-inbox': { q: string; page: string; folder: MailFolder }; 'email-thread': { id: string } };
export type InboxApi = <Action extends keyof InboxResults>(action: Action, data: InboxInputs[Action]) => Promise<InboxResults[Action]>;

const listDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const compactTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not reach Gmail. Try again.';

function senderName(value: string) {
  return value.split('<')[0].trim().replace(/^"|"$/g, '') || value.replace(/^<|>$/g, '');
}

function replyAddress(header: string) {
  const candidate = header.match(/<([^<>]+)>/)?.[1]?.trim() ?? header.split(',')[0].trim();
  return mailAddress(candidate) ? candidate : '';
}

export class WorkspaceInbox {
  private readonly root: HTMLElement;
  private readonly api: InboxApi;
  private readonly reconnect: () => void;
  private readonly composeReply: (draft: ReplyDraft) => void;
  private readonly list: HTMLElement;
  private readonly listPanel: HTMLElement;
  private readonly listTitle: HTMLElement;
  private readonly listStatus: HTMLElement;
  private readonly listScroll: HTMLElement;
  private readonly search: HTMLFormElement;
  private readonly refresh: HTMLButtonElement;
  private readonly folders: HTMLButtonElement[];
  private readonly folderNav: HTMLElement;
  private readonly inboxFilters: HTMLElement;
  private readonly filters: HTMLButtonElement[];
  private readonly listCount: HTMLElement;
  private readonly clearSearch: HTMLButtonElement;
  private readonly input: HTMLInputElement;
  private readonly more: HTMLButtonElement;
  private readonly title: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly reader: HTMLElement;
  private readonly openGmail: HTMLAnchorElement;
  private readonly previousThread: HTMLButtonElement;
  private readonly nextThread: HTMLButtonElement;
  private account = '';
  private folder: MailFolder = 'inbox';
  private query = '';
  private next = '';
  private listVersion = 0;
  private detailVersion = 0;
  private selected: HTMLButtonElement | null = null;
  private listOffset = 0;
  private entries = new Set<string>();
  private automaticImages = false;
  private formattedMessages: Array<(enabled: boolean) => void> = [];
  private replyEnabled = false;

  constructor(root: HTMLElement, api: InboxApi, reconnect: () => void, composeReply: (draft: ReplyDraft) => void) {
    this.root = root.querySelector<HTMLElement>('#gmail-mailbox')!;
    this.api = api;
    this.reconnect = reconnect;
    this.composeReply = composeReply;
    this.list = root.querySelector<HTMLElement>('#gmail-threads')!;
    this.listPanel = root.querySelector<HTMLElement>('#gmail-list-panel')!;
    this.listTitle = root.querySelector<HTMLElement>('#gmail-list-heading')!;
    this.listCount = root.querySelector<HTMLElement>('#gmail-list-count')!;
    this.listStatus = root.querySelector<HTMLElement>('#gmail-list-status')!;
    this.listScroll = root.querySelector<HTMLElement>('#gmail-list-scroll')!;
    this.search = root.querySelector<HTMLFormElement>('#gmail-search')!;
    this.refresh = root.querySelector<HTMLButtonElement>('#gmail-refresh')!;
    this.folderNav = root.querySelector<HTMLElement>('#gmail-folders')!;
    this.folders = [...root.querySelectorAll<HTMLButtonElement>('[data-mail-folder]')];
    this.inboxFilters = root.querySelector<HTMLElement>('#gmail-inbox-filters')!;
    this.filters = [...this.inboxFilters.querySelectorAll<HTMLButtonElement>('[data-inbox-filter]')];
    this.clearSearch = root.querySelector<HTMLButtonElement>('#gmail-clear-search')!;
    this.input = root.querySelector<HTMLInputElement>('#gmail-search-query')!;
    this.more = root.querySelector<HTMLButtonElement>('#gmail-more')!;
    this.title = root.querySelector<HTMLElement>('#gmail-thread-heading')!;
    this.detail = root.querySelector<HTMLElement>('#gmail-messages')!;
    this.reader = root.querySelector<HTMLElement>('#gmail-reader')!;
    this.openGmail = root.querySelector<HTMLAnchorElement>('#gmail-open-thread')!;
    this.previousThread = root.querySelector<HTMLButtonElement>('#gmail-previous-thread')!;
    this.nextThread = root.querySelector<HTMLButtonElement>('#gmail-next-thread')!;
    this.search.addEventListener('submit', event => {
      event.preventDefault();
      this.query = this.input.value.trim();
      void this.load();
    });
    this.refresh.addEventListener('click', () => void this.load());
    this.clearSearch.addEventListener('click', () => {
      this.input.value = this.query = '';
      this.input.focus();
      void this.load();
    });
    for (const button of [...this.folders, ...this.filters]) {
      button.addEventListener('click', () => {
        this.folder = (button.dataset.mailFolder ?? button.dataset.inboxFilter) as MailFolder;
        this.input.value = this.query = '';
        void this.load();
      });
    }
    root.querySelector('#gmail-back')!.addEventListener('click', () => this.closeThread(true));
    this.previousThread.addEventListener('click', () => this.selected?.parentElement?.previousElementSibling?.querySelector('button')?.click());
    this.nextThread.addEventListener('click', () => this.selected?.parentElement?.nextElementSibling?.querySelector('button')?.click());
    this.more.addEventListener('click', () => { if (this.next) void this.load(this.next); });
  }

  setAccount(email = '') {
    if (this.account === email) return;
    this.account = email;
    this.root.hidden = !email;
    this.folderNav.hidden = this.refresh.hidden = this.search.hidden = !email;
    this.listVersion++;
    this.entries.clear();
    this.list.replaceChildren();
    this.listStatus.textContent = '';
    this.input.value = this.query = this.next = '';
    this.folder = 'inbox';
    this.clearSearch.hidden = true;
    this.more.hidden = true;
    this.closeThread();
    if (email) void this.load();
  }

  setAutomaticImages(enabled: boolean) {
    this.automaticImages = enabled;
    for (const apply of this.formattedMessages) apply(enabled);
  }

  setReplyEnabled(enabled: boolean) {
    this.replyEnabled = enabled;
    for (const button of this.detail.querySelectorAll<HTMLButtonElement>('.gmail-reply')) button.hidden = !enabled;
  }

  refreshAfterSend(reply?: MailReply) {
    if (reply && this.selected?.dataset.threadId === reply.threadId) this.selected.click();
    else if (this.folder === 'sent' && this.reader.hidden) void this.load();
  }

  private node<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, text?: string, css?: string) {
    const element = this.root.ownerDocument.createElement(tag);
    if (text) element.textContent = text;
    if (css) element.className = css;
    return element;
  }

  private handleError(error: unknown, destination: HTMLElement) {
    if (error instanceof Error && 'code' in error && error.code === 'gmail-reconnect') this.reconnect();
    else destination.textContent = errorText(error);
  }

  private async load(page = '') {
    if (!this.account) return;
    const version = ++this.listVersion;
    const inboxView = inboxViews.has(this.folder);
    const selectedFolder = inboxView ? 'inbox' : this.folder;
    this.listTitle.textContent = this.query ? 'Search results' : folderNames[selectedFolder];
    this.inboxFilters.hidden = Boolean(this.query) || !inboxView;
    this.clearSearch.hidden = !this.query;
    for (const button of this.folders) {
      if (!this.query && button.dataset.mailFolder === selectedFolder) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    for (const button of this.filters) button.setAttribute('aria-pressed', String(button.dataset.inboxFilter === this.folder));
    if (!page) {
      this.closeThread();
      this.entries.clear();
      this.list.replaceChildren();
      this.listScroll.scrollTop = 0;
      this.listCount.hidden = true;
      this.next = '';
      this.more.hidden = true;
    }
    this.more.disabled = true;
    this.listStatus.textContent = page ? 'Loading more conversations…' : 'Loading conversations…';
    try {
      const result = await this.api('email-inbox', { q: this.query, page, folder: this.folder });
      if (version !== this.listVersion) return;
      const moreHadFocus = this.root.ownerDocument.activeElement === this.more;
      const rows = result.threads.filter(entry => {
        if (this.entries.has(entry.id)) return false;
        this.entries.add(entry.id);
        return true;
      }).map(entry => this.row(entry));
      this.list.append(...rows);
      this.updateThreadControls();
      this.next = result.nextPage ?? '';
      this.more.hidden = !this.next;
      this.listCount.textContent = this.entries.size + ' shown';
      this.listCount.hidden = this.entries.size === 0;
      this.listStatus.textContent = this.entries.size ? '' : this.emptyMessage();
      if (moreHadFocus && rows.length) rows[0].querySelector('button')?.focus();
    } catch (error) {
      if (version === this.listVersion) this.handleError(error, this.listStatus);
    } finally {
      if (version === this.listVersion) this.more.disabled = false;
    }
  }

  private emptyMessage() {
    if (this.next) return 'No matching conversations on this page.';
    if (this.query) return 'No conversations match this search.';
    if (this.folder === 'read' || this.folder === 'unread') return 'No ' + this.folder + ' conversations in your inbox.';
    if (this.folder === 'inbox') return 'Your inbox is empty.';
    return 'No conversations to show.';
  }

  private row(entry: Summary) {
    const item = this.node('li');
    const button = this.node('button', undefined, 'gmail-thread-row');
    button.type = 'button';
    button.dataset.threadId = entry.id;
    if (entry.unread) button.classList.add('is-unread');
    const name = senderName(entry.recipient || entry.from);
    const detail = this.node('span', undefined, 'gmail-thread-row-copy');
    const sender = this.node('span', entry.recipient ? 'To: ' + name : name, 'gmail-thread-from');
    sender.title = sender.textContent ?? '';
    detail.append(this.node('strong', entry.subject, 'gmail-thread-subject'));
    if (entry.unread) button.append(this.node('span', 'Unread', 'sr-only'));
    if (entry.snippet) detail.append(this.node('span', entry.snippet, 'gmail-thread-snippet'));
    button.append(this.avatar(name), sender, detail);
    if (entry.at) button.append(this.date(entry.at));
    button.addEventListener('click', () => void this.open(entry, button));
    item.append(button);
    return item;
  }

  private closeThread(refocus = false) {
    this.detailVersion++;
    this.reader.hidden = true;
    this.listPanel.hidden = false;
    this.selected?.removeAttribute('aria-current');
    if (refocus) {
      this.listScroll.scrollTop = this.listOffset;
      this.selected?.focus();
    }
    this.selected = null;
    this.title.textContent = '';
    this.openGmail.hidden = true;
    this.openGmail.removeAttribute('href');
    this.formattedMessages = [];
    this.detail.replaceChildren();
  }

  private updateThreadControls() {
    const row = this.selected?.parentElement;
    this.previousThread.disabled = !row?.previousElementSibling;
    this.nextThread.disabled = !row?.nextElementSibling;
  }

  private async open(entry: Summary, button: HTMLButtonElement) {
    const version = ++this.detailVersion;
    if (!this.listPanel.hidden) this.listOffset = this.listScroll.scrollTop;
    this.selected?.removeAttribute('aria-current');
    this.selected = button;
    this.updateThreadControls();
    button.setAttribute('aria-current', 'true');
    this.listPanel.hidden = true;
    this.reader.hidden = false;
    this.reader.scrollTop = 0;
    this.title.textContent = entry.subject;
    this.title.focus({ preventScroll: true });
    this.reader.scrollIntoView?.({ block: 'start' });
    const gmail = new URL('https://mail.google.com/mail/');
    gmail.searchParams.set('authuser', this.account);
    gmail.hash = 'all/' + encodeURIComponent(entry.id);
    this.openGmail.href = gmail.href;
    this.openGmail.hidden = false;
    const status = this.node('p', 'Loading conversation…', 'gmail-mail-status');
    status.setAttribute('role', 'status');
    this.formattedMessages = [];
    this.detail.replaceChildren(status);
    try {
      const result = await this.api('email-thread', { id: entry.id });
      if (version !== this.detailVersion) return;
      this.title.textContent = result.subject;
      const nodes: HTMLElement[] = result.messages.map((message, index) =>
        this.message(message, index === result.messages.length - 1, { id: entry.id, subject: result.subject }));
      if (result.earlier) nodes.unshift(this.node('p', 'Open in Gmail to see earlier messages.', 'gmail-mail-status'));
      if (!nodes.length) nodes.push(this.node('p', 'This conversation is empty.', 'gmail-mail-status'));
      this.detail.replaceChildren(...nodes);
    } catch (error) {
      if (version === this.detailVersion) this.handleError(error, status);
    }
  }

  private avatar(name: string) {
    const avatar = this.node('span', initials(name) || '•', 'gmail-message-avatar');
    avatar.setAttribute('aria-hidden', 'true');
    return avatar;
  }

  private date(timestamp: number, detail = false) {
    const today = new Date().toDateString() === new Date(timestamp).toDateString();
    const date = this.node('time', (detail ? fullDate : today ? compactTime : listDate).format(timestamp));
    date.dateTime = new Date(timestamp).toISOString();
    return date;
  }

  private message(message: Message, expanded: boolean, conversation: { id: string; subject: string }) {
    const article = this.node('details', undefined, 'gmail-message');
    article.open = expanded;
    const name = senderName(message.from);
    const head = this.node('summary', undefined, 'gmail-message-heading');
    const who = this.node('span', undefined, 'gmail-sender');
    who.append(this.node('strong', name), this.node('span', message.from === name ? '' : message.from, 'gmail-sender-address'));
    head.append(this.avatar(name), who);
    if (message.at) head.append(this.date(message.at, true));
    article.append(head);
    const content = this.node('div', undefined, 'gmail-message-content');
    const metadata = this.node('div', undefined, 'gmail-message-meta');
    if (message.to) metadata.append(this.node('p', 'To ' + message.to, 'gmail-message-to'));
    const details = this.node('details', undefined, 'gmail-message-details');
    const fields = this.node('dl');
    for (const [field, value] of [['From', message.from], ['To', message.to], ['Cc', message.cc], ['Reply-to', message.replyTo]]) {
      if (value) fields.append(this.node('dt', field), this.node('dd', value));
    }
    details.append(this.node('summary', 'Message details'), fields);
    metadata.append(details);
    content.append(metadata);
    if (message.formatted) {
      const { section, setAutomaticImages } = mailFormattedView(article, message.formatted);
      this.formattedMessages.push(setAutomaticImages);
      setAutomaticImages(this.automaticImages);
      content.append(section);
    } else if (message.visualPreview) {
      content.append(mailVisualPreview(this.root.ownerDocument, { ...message, summary: message.visualPreview.summary }, this.openGmail.href));
    } else {
      if (message.previewOnly) content.append(originalMailLink(this.root.ownerDocument, this.openGmail.href));
      if (message.body || message.content?.length) content.append(mailReadingBody(this.root.ownerDocument, message.body, message.content));
    }
    if (message.attachments?.length) content.append(mailAttachments(this.root.ownerDocument, message.attachments, this.openGmail.href));
    const from = replyAddress(message.from);
    const recipient = from.toLowerCase() === this.account.toLowerCase() ? replyAddress(message.to) : replyAddress(message.replyTo ?? '') || from;
    if (recipient) {
      const reply = this.node('button', 'Reply', 'button button-outline gmail-reply');
      reply.type = 'button';
      reply.hidden = !this.replyEnabled;
      reply.addEventListener('click', () => this.composeReply({
        recipient, subject: (/^re:/i.test(conversation.subject) ? conversation.subject : 'Re: ' + conversation.subject).slice(0, mailLimits.subject),
        reply: { threadId: conversation.id, messageId: message.id },
      }));
      content.append(reply);
    }
    article.append(content);
    return article;
  }
}
