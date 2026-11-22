import { randomUUID } from 'node:crypto';
import { readRecord, writeRecord } from './store.mjs';
import { listOriginalSubmissions } from './submissions.mjs';
import { openSubmissionArchive, recoveredKey, sealSubmissionArchive, submissionBackupKey } from './submission-archive.mjs';

const catalogKey = 'submission-backups/catalog';
const archiveKey = id => 'submission-backups/archive/' + id;
const validId = /^\d{4}-\d{2}-\d{2}(?:-[\da-f-]{36})?$/;
const errors = {
  disabled: () => Object.assign(new Error('Set the server backup encryption key before using backups.'), { status: 503 }),
  missing: () => Object.assign(new Error('Choose an available backup.'), { status: 404 }),
};

export function submissionBackups({
  key = submissionBackupKey(), read = readRecord, write = writeRecord, originals = listOriginalSubmissions,
  now = () => new Date(),
} = {}) {
  async function update(recordKey, change) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await read(recordKey);
      const { data, result } = change(current.data);
      if (data === undefined) return result;
      try {
        await write(recordKey, data, current.revision);
        return result;
      } catch (error) { if (error.status !== 409 || attempt === 4) throw error; }
    }
  }

  function requireKey() {
    if (!key) throw errors.disabled();
  }

  async function getArchive(id) {
    if (typeof id !== 'string' || !validId.test(id)) throw errors.missing();
    const { data } = await read(archiveKey(id));
    if (!data) throw errors.missing();
    return data;
  }

  return {
    async status() {
      const { data } = await read(catalogKey);
      return { enabled: Boolean(key), copies: data?.copies ?? [] };
    },
    async capture(request, { scheduled = false } = {}) {
      requireKey();
      const createdAt = now().toISOString();
      const day = createdAt.slice(0, 10);
      const id = scheduled ? day : day + '-' + randomUUID();
      const name = archiveKey(id);
      let archive = (await read(name)).data;
      if (!archive) {
        const [source, saved] = await Promise.all([originals(request), read(recoveredKey)]);
        const ids = new Set(source.map(item => item.id));
        const recovered = saved.data ? openSubmissionArchive(saved.data, key, recoveredKey) : [];
        const items = [...source, ...recovered.filter(item => !ids.has(item.id))];
        const quotes = items.filter(item => (item.form_name || item.data?.['form-name']) === 'quote-request').length;
        const info = { id, createdAt, quotes, reviews: items.length - quotes };
        const sealed = sealSubmissionArchive(items, key, name, info);
        archive = await update(name, current => current ? { result: current } : { data: sealed, result: sealed });
      }
      await update(catalogKey, current => {
        const copies = current?.copies ?? [];
        if (copies.some(copy => copy.id === id)) return {};
        return { data: { copies: [archive.info, ...copies].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30) } };
      });
      return archive.info;
    },
    async restore(request, id) {
      requireKey();
      const [archive, source] = await Promise.all([getArchive(id), originals(request)]);
      const archived = openSubmissionArchive(archive, key, archiveKey(id));
      const sourceIds = new Set(source.map(item => item.id));
      return update(recoveredKey, current => {
        const recovered = current ? openSubmissionArchive(current, key, recoveredKey) : [];
        const known = new Set([...sourceIds, ...recovered.map(item => item.id)]);
        const missing = archived.filter(item => {
          if (known.has(item.id)) return false;
          known.add(item.id);
          return true;
        });
        if (!missing.length) return { result: { restored: 0 } };
        const data = sealSubmissionArchive([...recovered, ...missing], key, recoveredKey, { updatedAt: now().toISOString() });
        return { data, result: { restored: missing.length } };
      });
    },
    async download(id) {
      const archive = await getArchive(id);
      return new Response(JSON.stringify(archive), { headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'attachment; filename="rs-submissions-' + id + '.json"',
      } });
    },
  };
}
