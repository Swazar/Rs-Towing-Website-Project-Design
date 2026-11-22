import { mapInBatches, readRecord, writeRecord } from '../store.mjs';
import { formatJobNumber, jobNumberGroup, type ServiceCode } from '../../../src/domain/jobs/job-number.ts';
import { isQuote, type Submission } from '../../../src/domain/jobs/types.ts';

interface NumberLedger {
  next: number;
  sequences: Record<string, number>;
}

interface LedgerStore {
  readRecord(key: string): Promise<{ data: NumberLedger | null; revision: string | null }>;
  writeRecord(key: string, data: NumberLedger, revision: string | null): Promise<unknown>;
}

interface NumberGroup {
  period: string;
  code: ServiceCode;
  items: Submission[];
}

const storage: LedgerStore = { readRecord, writeRecord };
const recordKey = (id: string) => 'submission:' + id;
const ledgerKey = (period: string, code: ServiceCode) => `job-numbers/v1/${period}/${code}`;

async function assignGroup(key: string, submissions: Submission[], store: LedgerStore) {
  // Reserve one chronological batch per service/month. Retries re-read the
  // winner's ledger instead of reissuing numbers or modifying job records.
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, revision } = await store.readRecord(key);
    const ledger = data ?? { next: 1, sequences: {} };
    const sequences = { ...ledger.sequences };
    let next = ledger.next;
    for (const item of submissions) {
      const id = recordKey(item.id);
      if (!Object.hasOwn(sequences, id)) sequences[id] = next++;
    }
    if (next === ledger.next) return sequences;
    try {
      await store.writeRecord(key, { next, sequences }, revision);
      return sequences;
    } catch (error) {
      if (!(error instanceof Error && 'status' in error && error.status === 409) || attempt === 7) throw error;
    }
  }
  throw new Error('Job numbers could not be reserved.');
}

export async function assignJobNumbers(submissions: Submission[], store: LedgerStore = storage) {
  const groups = new Map<string, NumberGroup>();
  for (const item of submissions) {
    if (!isQuote(item)) continue;
    const group = jobNumberGroup(item.created_at, item.data.service);
    const key = ledgerKey(group.period, group.code);
    const existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { ...group, items: [item] });
  }
  const entries = await mapInBatches([...groups], async ([key, group]) => {
    const timestamp = (item: Submission) => Date.parse(item.created_at) || 0;
    const items = group.items.sort((a, b) => timestamp(a) - timestamp(b) || a.id.localeCompare(b.id));
    const sequences = await assignGroup(key, items, store);
    return items.map(item => [item.id, formatJobNumber(group.period, group.code, sequences[recordKey(item.id)])] as const);
  }, 8);
  return new Map(entries.flat());
}

export async function issuedJobNumbers(submissions: Submission[], store: LedgerStore = storage) {
  const ledgers = new Map<string, Promise<{ data: NumberLedger | null; revision: string | null }>>();
  const aliases = await mapInBatches(submissions, async item => {
    const { period, code } = jobNumberGroup(item.created_at, item.data.service);
    const key = ledgerKey(period, code);
    if (!ledgers.has(key)) ledgers.set(key, store.readRecord(key));
    const ledger = await ledgers.get(key);
    const sequence = ledger?.data?.sequences[recordKey(item.id)];
    return [item.id, sequence ? formatJobNumber(period, code, sequence) : ''] as const;
  }, 8);
  return new Map(aliases);
}
