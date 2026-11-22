import { priceInput } from '../../../public/assets/enquiry-contact.js';
import { businessDateKey } from './dates.ts';
import { normalizeJobNumber } from './job-number.ts';
import { isQuote, type Enquiry } from './types.ts';

export interface EnquiryQuery {
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  sort?: string;
}

export function filterEnquiries<Item extends Enquiry>(items: Item[], options: EnquiryQuery = {}): Item[] {
  const { status = '', search = '', from = '', to = '', sort = 'newest' } = options;
  const text = search.trim().toLowerCase();
  const reference = normalizeJobNumber(text);
  const active = ['Contacted', 'Quoted', 'Booked'];
  const pickup = (item: Enquiry) => item.state?.scheduledDate || item.data.pickup_date || '9999';
  return items.filter(item => {
    if (!isQuote(item)) return false;
    const state = item.state?.status || 'New';
    if (status && (status === 'active' ? !active.includes(state) : state !== status)) return false;
    if (text) {
      const searchable = [item.id, ...item.duplicateIds ?? [], item.data.name, item.data.pickup, item.data.dropoff, item.data.service].join(' ').toLowerCase();
      const foundNumber = reference && [item.jobNumber, ...item.jobNumberAliases ?? []].some(number => number && normalizeJobNumber(number).includes(reference));
      if (!searchable.includes(text) && !foundNumber) return false;
    }
    const received = businessDateKey(new Date(item.created_at));
    return (!from || Boolean(received && received >= from)) && (!to || Boolean(received && received <= to));
  }).sort((a, b) => sort === 'oldest' ? a.created_at.localeCompare(b.created_at)
    : sort === 'pickup' ? pickup(a).localeCompare(pickup(b))
      : b.created_at.localeCompare(a.created_at));
}

export function csvCell(value: unknown) {
  let text = String(value ?? '').replace(/\0/g, '');
  // Neutralize spreadsheet formulas, even inside quoted cells.
  if (/^[\s\uFEFF]*[=+@\-]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function enquiryCSV(items: Enquiry[]) {
  const rows = [['Job number', 'Received', 'Name', 'Phone', 'Email', 'Service', 'Pickup', 'Drop-off', 'Status', 'Requested date',
    'Confirmed pickup', 'Pickup time (Eastern)', 'Follow-up', 'Private note', 'Agreed price (USD)']];
  for (const { jobNumber, created_at, data, state } of items) {
    rows.push([jobNumber ?? '', created_at, data.name ?? '', data.phone ?? '', data.email ?? '', data.service ?? '',
      data.pickup ?? '', data.dropoff ?? '', state?.status || 'New', data.pickup_date ?? '', state?.scheduledDate ?? '',
      state?.scheduledTime ?? '', state?.followUp ?? '', state?.note ?? '', priceInput(state?.priceCents)]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
