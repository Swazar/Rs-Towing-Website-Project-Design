import { listSubmissions } from '../submissions.mjs';
import { mapInBatches, readRecord } from '../store.mjs';
import { activeData } from '../recovery.mjs';
import { isQuote, quoteRequestId, type Submission } from '../../../src/domain/jobs/types.ts';
import { assignJobNumbers, issuedJobNumbers } from './number-store.ts';

async function foldQuoteRetries(submissions: Submission[]) {
  const groups = new Map<string, Submission[]>();
  const unique: Submission[] = [];
  for (const item of submissions) {
    const requestId = quoteRequestId(item);
    if (!requestId) {
      unique.push(item);
    } else {
      const group = groups.get(requestId) ?? [];
      group.push(item);
      groups.set(requestId, group);
    }
  }
  const duplicates = new Map<string, Submission[]>();
  const records = new Map<string, Awaited<ReturnType<typeof readRecord>>>();
  await mapInBatches([...groups.values()], async group => {
    if (group.length === 1) {
      unique.push(group[0]);
      return;
    }
    group.sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || a.id.localeCompare(b.id));
    let chosen = group[0];
    // Prefer a row already used by dispatch. A retry must not hide its booking.
    for (const item of group) {
      const record = await readRecord('enquiry/' + item.id);
      records.set(item.id, record);
      if (record.data) {
        chosen = item;
        break;
      }
    }
    unique.push(chosen);
    duplicates.set(chosen.id, group.filter(item => item.id !== chosen.id));
  }, 8);
  return { unique, duplicates, records };
}

export async function loadWorkspaceInbox(request: Request, includeReviews: boolean) {
  const all: Submission[] = await listSubmissions(request);
  const { unique: visible, duplicates, records } = await foldQuoteRetries(includeReviews ? all : all.filter(isQuote));
  const [publication, numbers, aliases] = await Promise.all([
    includeReviews ? readRecord('review-publication') : null,
    assignJobNumbers(visible),
    issuedJobNumbers([...duplicates.values()].flat()),
  ]);
  const items = await mapInBatches(visible, async item => {
    const record = isQuote(item)
      ? records.get(item.id) ?? await readRecord('enquiry/' + item.id)
      : { data: publication?.data?.decisions?.[item.id] ?? null, revision: publication?.revision ?? null };
    const duplicateIds = duplicates.get(item.id)?.map(entry => entry.id);
    return { ...item, jobNumber: numbers.get(item.id), state: activeData(record.data), revision: record.revision,
      ...(duplicateIds?.length ? { duplicateIds, jobNumberAliases: duplicateIds.map(id => aliases.get(id)).filter((number): number is string => Boolean(number)) } : {}) };
  });
  return { items, reviewActivity: publication?.data?.history ?? [] };
}
