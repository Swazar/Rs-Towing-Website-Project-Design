import { isQuote, type Enquiry } from '../domain/jobs/types.ts';
import { icon, node } from '../../public/assets/admin-ui.js';

type InboxItem = Enquiry & { data: { first_name?: string } };
type Entry = { id: string; item: InboxItem; quote: boolean; receivedAt: number };
type ReadState = { through: number; ids: string[] };

const refreshInterval = 2 * 60_000;
const initialReadState = (): ReadState => ({ through: -1, ids: [] });

interface Options {
  formatDate: (date: string) => string;
  refresh: () => Promise<void>;
  openEnquiry: (item: Enquiry) => void;
  openReview: (item: InboxItem) => void;
}

export class WorkspaceNotifications {
  private root: HTMLElement;
  private options: Options;
  private panel: HTMLElement;
  private trigger: HTMLButtonElement;
  private badge: HTMLElement;
  private list: HTMLUListElement;
  private feedback: HTMLElement;
  private refreshButton: HTMLButtonElement;
  private markAllButton: HTMLButtonElement;
  private entries: Entry[] = [];
  private read = initialReadState();
  private key = '';
  private canReview = false;
  private checking = false;
  private lastCheck = 0;

  constructor(root: HTMLElement, options: Options) {
    this.root = root;
    this.options = options;
    this.panel = root.querySelector('#notification-panel')!;
    this.trigger = root.querySelector('.notification-trigger')!;
    this.badge = root.querySelector('.notification-badge')!;
    this.list = root.querySelector('.notification-list')!;
    this.feedback = root.querySelector('.notification-feedback')!;
    this.refreshButton = root.querySelector('.notification-refresh')!;
    this.markAllButton = root.querySelector('.notification-read-all')!;

    this.trigger.addEventListener('click', () => {
      if (!this.panel.hidden) { this.close(); return; }
      this.panel.hidden = false;
      this.trigger.setAttribute('aria-expanded', 'true');
      this.panel.querySelector<HTMLElement>('h2')?.focus();
      void this.refresh(false);
    });
    this.refreshButton.addEventListener('click', () => { void this.refresh(true); });
    this.markAllButton.addEventListener('click', () => {
      this.read = { through: this.entries[0]?.receivedAt ?? this.read.through, ids: [] };
      this.saveReadState();
      this.feedback.textContent = 'All notifications marked as read.';
      this.render();
      this.panel.querySelector<HTMLElement>('h2')?.focus();
    });
    root.ownerDocument.addEventListener('click', event => {
      if (!this.panel.hidden && !root.contains(event.target as Node)) this.close();
    });
    root.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || this.panel.hidden) return;
      event.stopPropagation();
      this.close();
      this.trigger.focus();
    });
    root.ownerDocument.defaultView?.addEventListener('focus', () => { void this.refresh(false); });
  }

  start(accountId: string, canReview: boolean) {
    this.stop();
    this.key = 'rs-workspace-notifications-v1:' + accountId;
    this.canReview = canReview;
    this.lastCheck = Date.now();
    try {
      const saved = JSON.parse(this.root.ownerDocument.defaultView!.localStorage.getItem(this.key) || 'null');
      if (Number.isFinite(saved?.through) && Array.isArray(saved.ids)) {
        this.read = { through: saved.through, ids: saved.ids.filter((value: unknown) => typeof value === 'string').slice(-500) };
      }
    } catch { /* Keep read state in this page when browser storage is unavailable. */ }
    this.root.hidden = false;
    this.render();
  }

  stop() {
    this.close();
    this.root.hidden = true;
    this.key = '';
    this.entries = [];
    this.read = initialReadState();
    this.lastCheck = 0;
    this.list.replaceChildren();
    this.feedback.textContent = '';
  }

  update(items: InboxItem[], fresh = false) {
    if (this.root.hidden) return;
    if (fresh) this.lastCheck = Date.now();
    this.entries = items.flatMap(item => {
      const quote = isQuote(item);
      const review = this.canReview && (item.form_name || item.data['form-name']) === 'customer-review';
      if (quote ? item.state?.status && item.state.status !== 'New' : !review || item.state) return [];
      return [{ id: (quote ? 'quote:' : 'review:') + item.id, item, quote, receivedAt: Date.parse(item.created_at) || 0 }];
    }).sort((a, b) => b.receivedAt - a.receivedAt || a.id.localeCompare(b.id));
    this.render();
  }

  private close() {
    this.panel.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
  }

  private saveReadState() {
    try { this.root.ownerDocument.defaultView!.localStorage.setItem(this.key, JSON.stringify(this.read)); }
    catch { /* The current page can still show read state. */ }
  }

  private async refresh(force: boolean) {
    if (this.root.hidden || this.checking || (!force && Date.now() - this.lastCheck < refreshInterval)) return;
    this.lastCheck = Date.now();
    this.checking = this.refreshButton.disabled = true;
    this.feedback.textContent = 'Checking for new activity…';
    const account = this.key;
    try {
      await this.options.refresh();
      if (account === this.key) this.feedback.textContent = '';
    } catch {
      if (account === this.key) this.feedback.textContent = 'Couldn’t refresh notifications. Try again.';
    } finally {
      this.checking = this.refreshButton.disabled = false;
    }
  }

  private render() {
    const readIds = new Set(this.read.ids);
    const unread = (entry: Entry) => entry.receivedAt > this.read.through && !readIds.has(entry.id);
    const newEntries = this.entries.filter(unread);
    const count = newEntries.length;
    this.badge.hidden = count === 0;
    this.badge.textContent = count > 99 ? '99+' : String(count);
    this.trigger.setAttribute('aria-label', count ? 'Notifications, ' + count + ' unread' : 'Notifications');
    this.markAllButton.disabled = count === 0;
    const ordered = [...newEntries, ...this.entries.filter(entry => !unread(entry))];
    if (!ordered.length) {
      const empty = this.canReview ? 'New quotes and customer reviews will appear here.' : 'New quote requests will appear here.';
      this.list.replaceChildren(node('li', empty, 'notification-empty'));
      return;
    }

    this.list.replaceChildren(...ordered.slice(0, 30).map(entry => {
      const { item, quote } = entry;
      const row = node('li');
      const button = node('button', undefined, 'notification-item');
      button.type = 'button';
      const graphic = node('span', undefined, 'notification-item-icon');
      graphic.append(icon(quote ? 'inbox' : 'star'));
      const title = (quote ? 'Quote request' : 'Customer review') +
        (unread(entry) ? ' · New' : '');
      const customer = (quote ? item.data.name : item.data.first_name) || 'Customer';
      const description = quote && item.jobNumber ? customer + ' · ' + item.jobNumber : customer;
      const copy = node('span', undefined, 'notification-item-copy');
      copy.append(node('strong', title), node('span', description), node('small', this.options.formatDate(item.created_at)));
      button.append(graphic, copy);
      if (unread(entry)) button.append(node('span', undefined, 'notification-unread-dot'));
      button.addEventListener('click', () => {
        if (unread(entry)) {
          this.read.ids = [...this.read.ids, entry.id].slice(-500);
          this.saveReadState();
        }
        this.close();
        this.render();
        this.trigger.focus();
        if (quote) this.options.openEnquiry(item);
        else this.options.openReview(item);
      });
      row.append(button);
      return row;
    }));
    if (ordered.length > 30) this.list.append(node('li', this.canReview ?
      'Open Enquiries or Reviews for the full list.' : 'Open Enquiries for the full list.', 'notification-empty'));
  }
}
