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
  onSelect: (item: Enquiry) => void;
  onError: (error: unknown) => void;
}

export class Enquiries {
  private items: Enquiry[] = [];
  private selectedId?: string;
  private drafts = new Map<string, Draft>();
  private detail?: ReturnType<typeof createEnquiryDetail>;
  private search = document.querySelector<HTMLInputElement>('#enquiry-search')!;
  private status = document.querySelector<HTMLSelectElement>('#enquiry-filter')!;
  private from = document.querySelector<HTMLInputElement>('#enquiry-from')!;
  private to = document.querySelector<HTMLInputElement>('#enquiry-to')!;
  private sort = document.querySelector<HTMLSelectElement>('#enquiry-sort')!;
  private exportLink = document.querySelector<HTMLAnchorElement>('#enquiry-export')!;
  private sidebarCount = document.querySelector('#enquiry-count')!;
  private list = document.querySelector('#enquiry-list')!;
  private total = document.querySelector('#enquiry-result-count')!;
  private record = document.querySelector<HTMLElement>('#enquiry-detail')!;
  private options: EnquiriesOptions;

  constructor(options: EnquiriesOptions) {
    this.options = options;
    this.search.addEventListener('input', () => this.render());
    for (const control of [this.status, this.from, this.to, this.sort]) {
      control.addEventListener('change', () => this.render());
    }
  }

  get dirty() { return this.drafts.size > 0; }

  hasDraft(id: string) { return this.drafts.has(id); }

  setItems(items: Enquiry[]) {
    this.items = items;
    if (!this.selectedId) {
      this.selectedId = items.find(item => !item.state || item.state.status === 'New')?.id ?? items[0]?.id;
    }
    this.render();
  }

  setFilter(status: string) {
    this.status.value = status;
    this.search.value = '';
    this.render();
  }

  open(item: Enquiry) {
    this.status.value = this.search.value = this.from.value = this.to.value = '';
    this.selectedId = item.id;
    this.render();
  }

  openNumber(number: string) {
    const item = this.items.find(entry => entry.jobNumber === number || entry.id === number ||
      entry.jobNumberAliases?.includes(number) || entry.duplicateIds?.includes(number));
    if (item) this.open(item);
    return Boolean(item);
  }

  applySaved(item: Enquiry, saved: SavedEnquiry) {
    const current = this.items.find(entry => entry.id === item.id);
    if (current) Object.assign(current, { state: saved.data, revision: saved.revision });
    this.drafts.delete(item.id);
    this.render();
    if (this.selectedId === item.id) this.detail?.showEditor();
  }

  private filters(): Required<EnquiryQuery> {
    return { status: this.status.value, search: this.search.value, from: this.from.value, to: this.to.value, sort: this.sort.value };
  }

  render() {
    this.sidebarCount.textContent = String(this.items.filter(item => !item.state || item.state.status === 'New').length);
    const filters = this.filters();
    const filtered = filterEnquiries(this.items, filters);
    this.exportLink.href = '/.netlify/functions/owner?' + new URLSearchParams({ action: 'export', ...filters });
    if (!filtered.some(item => item.id === this.selectedId)) this.selectedId = filtered[0]?.id;
    this.total.textContent = String(filtered.length);

    const list = filtered.map(item => this.listRow(item));
    if (list.length) this.list.replaceChildren(...list);
    else this.list.replaceChildren(emptyState('No enquiries here', filters.search || filters.status || filters.from || filters.to
      ? 'Try another search or clear the filters.' : 'New requests will appear here.'));

    this.detail?.dispose();
    const item = filtered.find(entry => entry.id === this.selectedId);
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
    button.setAttribute('aria-pressed', String(this.selectedId === item.id));
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
      this.selectedId = item.id;
      this.render();
      this.options.onSelect(item);
      if (document.defaultView?.matchMedia?.('(max-width: 1000px)').matches) {
        this.record.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
      [...this.list.querySelectorAll<HTMLButtonElement>('[data-enquiry-id]')].find(row => row.dataset.enquiryId === item.id)?.focus({ preventScroll: true });
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
