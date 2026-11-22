import assert from 'node:assert/strict';
import test from 'node:test';
import { assignJobNumbers } from '../netlify/lib/jobs/number-store.ts';
import { describeJobNumber, enquiryLinkNumber, formatJobNumber, jobNumberGroup } from '../src/domain/jobs/job-number.ts';
import { enquiryCSV, filterEnquiries } from '../src/domain/jobs/queries.ts';

function ledgerStore() {
  const records = new Map();
  return {
    get count() { return records.size; },
    async readRecord(key) {
      return structuredClone(records.get(key) || { data: null, revision: null });
    },
    async writeRecord(key, data, revision) {
      if ((records.get(key)?.revision ?? null) !== revision) throw Object.assign(new Error('Conflict'), { status: 409 });
      const saved = { data, revision: crypto.randomUUID() };
      records.set(key, structuredClone(saved));
      return saved;
    },
  };
}

const quote = (id, created_at, service = 'Vehicle towing or transport') => ({
  id, created_at, form_name: 'quote-request', data: { name: 'Test customer', service },
});

test('job numbers group by Eastern received month and service and grow beyond four digits', () => {
  assert.deepEqual(jobNumberGroup('2026-12-01T04:59:00Z', 'Equipment hauling'), { period: '202611', code: 'EQP' });
  assert.deepEqual(jobNumberGroup('2026-12-01T05:00:00Z', 'Freight or cargo transport'), { period: '202612', code: 'FRT' });
  assert.deepEqual(jobNumberGroup('unavailable', 'Other'), { period: 'UNDATED', code: 'GEN' });
  assert.equal(formatJobNumber('202611', 'TOW', 10000), 'RS-202611-TOW-10000');
  assert.match(describeJobNumber('RS-202611-TOW-0001'), /November 2026.*Vehicle towing.*0001/);
  assert.equal(enquiryLinkNumber('#enquiries/rs-202611-tow-0001'), 'RS-202611-TOW-0001');
  assert.equal(enquiryLinkNumber('#enquiries/anything-else'), undefined);
});

test('legacy backfill is chronological and concurrent list requests never reassign issued numbers', async () => {
  const store = ledgerStore();
  const newer = quote('old-id-newer', '2026-11-05T14:00:00Z');
  const earlier = quote('old-id-earlier', '2026-11-01T05:00:00Z');
  const equipment = quote('equipment', '2026-11-05T14:00:00Z', 'Equipment hauling');
  const review = { ...quote('review', '2026-11-05T14:00:00Z'), form_name: 'customer-review' };
  const batch = [newer, equipment, earlier, review];
  const first = await assignJobNumbers(batch, store);
  assert.equal(first.get(earlier.id), 'RS-202611-TOW-0001');
  assert.equal(first.get(newer.id), 'RS-202611-TOW-0002');
  assert.equal(first.get(equipment.id), 'RS-202611-EQP-0001');
  assert.equal(first.has(review.id), false);
  assert.equal(store.count, 2);
  const jobA = quote('concurrent-a', '2026-11-22T14:00:00Z');
  const jobB = quote('concurrent-b', '2026-11-22T14:00:01Z');
  const [a, b] = await Promise.all([assignJobNumbers([jobA], store), assignJobNumbers([jobA, jobB], store)]);
  assert.equal(a.get(jobA.id), b.get(jobA.id));
  assert.notEqual(b.get(jobA.id), b.get(jobB.id));
  const after = await assignJobNumbers([jobB, newer, earlier, jobA], store);
  assert.equal(after.get(newer.id), first.get(newer.id));
  assert.equal(after.get(earlier.id), first.get(earlier.id));
  assert.equal(after.get(jobB.id), b.get(jobB.id));
});

test('job search accepts a pasted reference and retains legacy IDs and job numbers in exports', () => {
  const item = { ...quote('legacy-key-123', '2026-11-22T14:00:00Z'), jobNumber: 'RS-202611-TOW-0001' };
  const items = [item, { ...quote('another', '2026-11-22T14:01:00Z'), jobNumber: 'RS-202611-TOW-0002' }];
  assert.deepEqual(filterEnquiries(items, { search: 'Job #RS 202611 TOW 0001' }), [item]);
  assert.deepEqual(filterEnquiries(items, { search: 'legacy-key-123' }), [item]);
  assert.match(enquiryCSV([item]), /"Job number","Received"/);
  assert.match(enquiryCSV([item]), /"RS-202611-TOW-0001"/);
});
