export const enquiryStatuses = ['New', 'Contacted', 'Quoted', 'Booked', 'Closed'] as const;
export type EnquiryStatus = typeof enquiryStatuses[number];

export interface ChangeEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  subject: string;
}

export interface EnquiryState {
  status: EnquiryStatus;
  note: string;
  followUp: string;
  scheduledDate: string;
  scheduledTime: string;
  priceCents: number | null;
  updatedAt?: string;
  history?: ChangeEntry[];
}

export type EnquiryDraft = Pick<EnquiryState, 'note' | 'followUp' | 'scheduledDate' | 'scheduledTime'> & {
  status: string;
  agreedPrice: string;
};

export interface QuoteFields {
  'form-name'?: string;
  request_id?: string;
  name?: string;
  phone?: string;
  email?: string;
  service?: string;
  pickup?: string;
  dropoff?: string;
  pickup_point?: string;
  dropoff_point?: string;
  pickup_accuracy?: string;
  dropoff_accuracy?: string;
  pickup_timing?: string;
  pickup_date?: string;
  details?: string;
  vehicle_runs?: string;
  load_weight?: string;
  load_dimensions?: string;
}

export interface Submission {
  id: string;
  form_name?: string;
  created_at: string;
  data: QuoteFields;
}

export interface Enquiry extends Submission {
  state?: Partial<EnquiryState> | null;
  revision?: string | null;
  jobNumber?: string;
  duplicateIds?: string[];
  jobNumberAliases?: string[];
}

export function isQuote(item: Submission): boolean {
  return (item.form_name || item.data?.['form-name']) === 'quote-request';
}

export function quoteRequestId(item: Submission): string {
  const value = item.data?.request_id;
  return isQuote(item) && typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value) ? value.toLowerCase() : '';
}
