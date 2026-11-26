import { node, emptyState, statusLabel } from '../../../public/assets/admin-ui.js';
import { filterEnquiries, type EnquiryQuery } from '../../domain/jobs/queries.ts';
import type { Enquiry, EnquiryDraft, EnquiryState } from '../../domain/jobs/types.ts';
import { createEnquiryDetail, type Draft } from './detail.ts';

export interface SavedEnquiry {
  data: EnquiryState;
  revision: string;
}

interface EnquiriesOptions {
  date: (value: string) => string;
  shortDate: (value: string) => string;
  time: (value: string) => string;
  canRestore: () => boolean;
  onHistory: (item: Enquiry) => Promise<void>;
  onSave: (item: Enquiry, fields: EnquiryDraft, revision: Draft['revision']) => Promise<SavedEnquiry>;
  onSaved: (saved: SavedEnquiry) => void;
  onSelect: (item: Enquiry, compact: boolean) => void;
  onBack: () => void;
  onError: (error: unknown) => void;
}

const pageSize = 25;

export class Enquiries {
  private items: Enquiry[] = [];
  private selectedId?: string;
  private drafts = new Map<string, Draft>();
  private page = 1;
  private detail?: ReturnType<typeof createEnquiryDetail>;
  private returnScrollTop?: number;
  private workspace = document.querySelector<HTMLElement>('#enquiry-workspace')!;
  private compact = document.defaultView?.matchMedia?.('(max-width: 1000px)');
  private scroller = document.scrollingElement || document.documentElement;
  private search = document.querySelector<HTMLInputElement>('#enquiry-search')!;
  private status = document.querySelector<HTMLSelectElement>('#enquiry-filter')!;
  private from = document.querySelector<HTMLInputElement>('#enquiry-from')!;
  private to = document.querySelector<HTMLInputElement>('#enquiry-to')!;
  private sort = document.querySelector<HTMLSelectElement>('#enquiry-sort')!;
  private exportLink = document.querySelector<HTMLAnchorElement>('#enquiry-export')!;
  private sidebarCount = document.querySelector<HTMLElement>('#enquiry-count')!;
  private list = document.querySelector('#enquiry-list')!;
  private total = document.querySelector('#enquiry-result-count')!;
  private pagination = document.querySelector<HTMLElement>('#enquiry-pagination')!;
  private previous = document.querySelector<HTMLButtonElement>('#enquiry-previous')!;
  private next = document.querySelector<HTMLButtonElement>('#enquiry-next')!;
  private pageStatus = document.querySelector('#enquiry-page-status')!;
  private record = document.querySelector<HTMLElement>('#enquiry-detail')!;
  private options: EnquiriesOptions;

  constructor(options: EnquiriesOptions) {
    this.options = options;
    const filter = () => { this.page = 1; this.render(); };
    this.search.addEventListener('input', filter);
    for (const control of [this.status, this.from, this.to, this.sort]) {
      control.addEventListener('change', filter);
    }
    this.previous.addEventListener('click', () => this.changePage(-1));
    this.next.addEventListener('click', () => this.changePage(1));
    this.workspace.querySelector('#enquiry-list-back')!.addEventListener('click', options.onBack);
    this.compact?.addEventListener?.('change', () => {
      this.list.querySelectorAll<HTMLButtonElement>('[data-enquiry-id]').forEach(row => this.applyRowSelection(row));
    });
  }

  get dirty() { return this.drafts.size > 0; }

  hasDraft(id: string) { return this.drafts.has(id); }

  setItems(items: Enquiry[]) {
    this.items = items;
    const initial = !this.selectedId;
    if (initial) {
      this.selectedId = items.find(item => !item.state || item.state.status === 'New')?.id ?? items[0]?.id;
    }
    this.render(initial);
  }

  setFilter(status: string) {
    this.showInbox();
    this.status.value = status;
    this.search.value = '';
    this.page = 1;
    this.render();
  }

  showInbox(restorePosition = false) {
    const wasOpen = this.workspace.dataset.enquiryPane === 'detail';
    this.workspace.dataset.enquiryPane = 'list';
    if (!restorePosition || !wasOpen || !this.compact?.matches) return;
    const row = this.selectedRow();
    if (row && this.returnScrollTop !== undefined) {
      this.scroller.scrollTop = this.returnScrollTop;
      row.focus({ preventScroll: true });
    } else (row ?? this.search).focus();
  }

  focusDetail() {
    if (!this.compact?.matches || this.workspace.dataset.enquiryPane !== 'detail') return;
    const heading = this.record.querySelector<HTMLElement>('.record-heading h3');
    if (!heading) return;
    heading.tabIndex = -1;
    this.scroller.scrollTop = 0;
    heading.focus({ preventScroll: true });
  }

  open(item: Enquiry, preserveInbox = false) {
    const keepFilters = preserveInbox && filterEnquiries([item], this.filters()).length > 0;
    this.returnScrollTop = keepFilters ? this.scroller.scrollTop : undefined;
    if (!keepFilters) this.status.value = this.search.value = this.from.value = this.to.value = '';
    this.workspace.dataset.enquiryPane = 'detail';
    this.selectedId = item.id;
    this.render(true);
  }

  openNumber(number: string, preserveInbox = false) {
    const item = this.items.find(entry => entry.jobNumber === number || entry.id === number ||
      entry.jobNumberAliases?.includes(number) || entry.duplicateIds?.includes(number));
    if (item) this.open(item, preserveInbox);
    return Boolean(item);
  }

  private selectedRow() {
    return [...this.list.querySelectorAll<HTMLButtonElement>('[data-enquiry-id]')]
      .find(row => row.dataset.enquiryId === this.selectedId);
  }

  private applyRowSelection(row: HTMLButtonElement) {
    if (this.compact?.matches) row.removeAttribute('aria-pressed');
    else row.setAttribute('aria-pressed', String(this.selectedId === row.dataset.enquiryId));
  }

  applySaved(item: Enquiry, saved: SavedEnquiry) {
    const current = this.items.find(entry => entry.id === item.id);
    if (current) Object.assign(current, { state: saved.data, revision: saved.revision });
    this.drafts.delete(item.id);
    this.render(true);
    if (this.selectedId === item.id) this.detail?.showEditor();
  }

  private filters(): Required<EnquiryQuery> {
    return { status: this.status.value, search: this.search.value, from: this.from.value, to: this.to.value, sort: this.sort.value };
  }

  private changePage(direction: number) {
    this.page += direction;
    this.render();
    const control = direction < 0 ? this.previous : this.next;
    if (this.compact?.matches) {
      const row = this.list.querySelector<HTMLButtonElement>('button');
      row?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
      row?.focus({ preventScroll: true });
    } else if (control.disabled) this.list.querySelector<HTMLButtonElement>('button')?.focus();
  }

  render(followSelection = false) {
    const newCount = this.items.filter(item => !item.state || item.state.status === 'New').length;
    this.sidebarCount.textContent = String(newCount);
    this.sidebarCount.hidden = newCount === 0;
    const filters = this.filters();
    const filtered = filterEnquiries(this.items, filters);
    this.exportLink.href = '/.netlify/functions/owner?' + new URLSearchParams({ action: 'export', ...filters });
    const selectedIndex = followSelection ? filtered.findIndex(item => item.id === this.selectedId) : -1;
    if (selectedIndex >= 0) this.page = Math.floor(selectedIndex / pageSize) + 1;
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    this.page = Math.max(1, Math.min(this.page, pageCount));
    const offset = (this.page - 1) * pageSize;
    const visible = filtered.slice(offset, offset + pageSize);
    const inCompactDetail = this.compact?.matches && this.workspace.dataset.enquiryPane === 'detail';
    const openItem = inCompactDetail ? this.items.find(item => item.id === this.selectedId) : undefined;
    if (inCompactDetail && !openItem) this.showInbox();
    if (!openItem && !visible.some(item => item.id === this.selectedId)) this.selectedId = visible[0]?.id;
    this.total.textContent = String(filtered.length);
    this.pagination.hidden = pageCount <= 1;
    this.previous.disabled = this.page === 1;
    this.next.disabled = this.page === pageCount;
    this.pageStatus.textContent = 'Page ' + this.page + ' of ' + pageCount;

    const list = visible.map(item => this.listRow(item));
    if (list.length) this.list.replaceChildren(...list);
    else this.list.replaceChildren(emptyState('No enquiries here', filters.search || filters.status || filters.from || filters.to
      ? 'Try another search or clear the filters.' : 'New requests will appear here.'));

    this.detail?.dispose();
    const item = openItem ?? visible.find(entry => entry.id === this.selectedId);
    if (item) this.renderDetail(item);
    else {
      this.detail = undefined;
      this.record.replaceChildren(emptyState('Choose an enquiry', 'Route, customer details, and your notes will appear here.', 'clipboard-list'));
    }
  }

  private listRow(item: Enquiry) {
    const { data, state } = item;
    const button = node('button', undefined, 'enquiry-row');
    button.type = 'button';
    button.dataset.enquiryId = item.id;
    this.applyRowSelection(button);
    const heading = node('span', undefined, 'enquiry-row-head');
    heading.append(node('strong', data.name || 'Customer'), node('time', this.options.shortDate(item.created_at)));
    const route = node('span', undefined, 'mini-route');
    route.append(node('span', data.pickup), node('span', data.dropoff === 'Unsure' ? 'Drop-off not decided' : data.dropoff));
    const footer = node('span', undefined, 'enquiry-row-footer');
    footer.append(statusLabel(state?.status), node('small', data.pickup_timing));
    button.append(heading);
    if (item.jobNumber) button.append(node('span', item.jobNumber, 'enquiry-row-number'));
    button.append(node('span', data.service, 'service-label'), route, footer);
    button.addEventListener('click', () => {
      const compact = Boolean(this.compact?.matches);
      this.returnScrollTop = compact ? this.scroller.scrollTop : undefined;
      this.workspace.dataset.enquiryPane = 'detail';
      this.selectedId = item.id;
      this.render();
      this.options.onSelect(item, compact);
      if (compact) this.focusDetail();
      else this.selectedRow()?.focus({ preventScroll: true });
    });
    return button;
  }

  private renderDetail(item: Enquiry) {
    const options = this.options;
    this.detail = createEnquiryDetail(item, {
      date: options.date, time: options.time, draft: this.drafts.get(item.id),
      onDraft: fields => {
        const original = this.drafts.get(item.id);
        this.drafts.set(item.id, { fields, revision: original ? original.revision : item.revision });
      },
      onDiscard: () => { this.drafts.delete(item.id); this.render(); this.detail?.showEditor(true); },
      onSave: async (fields, revision) => {
        const current = this.drafts.get(item.id);
        const saved = await options.onSave(item, fields, current ? current.revision : revision);
        this.applySaved(item, saved);
        options.onSaved(saved);
      },
      onHistory: options.canRestore() ? () => options.onHistory(item) : undefined,
      onError: options.onError,
    });
    this.record.replaceChildren(this.detail.element);
  }
}
