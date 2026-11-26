export const serviceCodes = {
  VEH: 'Scheduled vehicle hauling',
  TOW: 'Vehicle transport (legacy)',
  EQP: 'Equipment hauling',
  FRT: 'Freight and cargo',
  GEN: 'General enquiries',
} as const;

export type ServiceCode = keyof typeof serviceCodes;

const easternMonth = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
});

export function jobNumberGroup(receivedAt: string, service = '') {
  const date = new Date(receivedAt);
  const parts = Number.isFinite(date.valueOf()) ? easternMonth.formatToParts(date) : [];
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const normalized = typeof service === 'string' ? service.toLowerCase() : '';
  const code: ServiceCode = /\bequipment\b/.test(normalized) ? 'EQP'
    : /\b(freight|cargo)\b/.test(normalized) ? 'FRT'
    : normalized === 'scheduled vehicle hauling' ? 'VEH'
    : /\b(tow(?:ing)?|vehicle|roadside)\b/.test(normalized) ? 'TOW' : 'GEN';
  return { period: year && month ? year.padStart(4, '0') + month : 'UNDATED', code };
}

export function formatJobNumber(period: string, code: ServiceCode, sequence: number) {
  return `RS-${period}-${code}-${String(sequence).padStart(4, '0')}`;
}

export function normalizeJobNumber(value: string) {
  return value.toUpperCase().replace(/^\s*JOB(?:\s*#\s*|\s+)/i, '').replace(/[^A-Z0-9]/g, '');
}

export function enquiryLinkNumber(hash: string) {
  const number = /^#enquiries\/(RS-(?:\d{6}|UNDATED)-(?:VEH|EQP|FRT|GEN|TOW)-\d{4,})$/i.exec(hash)?.[1];
  return number?.toUpperCase();
}

export function enquiryHash(jobNumber: string) {
  return '#enquiries/' + jobNumber;
}

export function describeJobNumber(value: string) {
  if (!enquiryLinkNumber('#enquiries/' + value)) return '';
  const [, period, code, sequence] = value.split('-');
  const date = new Date(`${period.slice(0, 4)}-${period.slice(4)}-01T00:00:00Z`);
  const received = Number.isFinite(date.valueOf())
    ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
    : 'Received date unavailable';
  return `RS on the Go · ${received} · ${serviceCodes[code as ServiceCode]} · Sequence ${sequence}`;
}
