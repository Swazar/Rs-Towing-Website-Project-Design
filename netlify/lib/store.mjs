import { getStore } from '@netlify/blobs';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export function isLocalPreview(request, env = process.env) {
  return env.NETLIFY_DEV === 'true' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
}

export function deployContext(env = process.env) {
  return globalThis.Netlify?.context?.deploy?.context || env.CONTEXT;
}

export function storeName(context, env = process.env) {
  if (context !== 'production') return 'rs-owner-sandbox';
  if (['rs-owner-production', 'rs-owner-preview'].includes(env.RS_OWNER_STORE)) return env.RS_OWNER_STORE;
  // Preserve the live namespace chosen by older releases, which used the
  // build-only CONTEXT variable and usually fell back to rs-owner-preview.
  return env.CONTEXT === 'production' ? 'rs-owner-production' : 'rs-owner-preview';
}

export function storeFor() {
  return getStore({ name: storeName(deployContext()), consistency: 'strong' });
}

export async function readRecord(key) {
  if (process.env.NETLIFY_DEV === 'true') return readLocal(key);
  const record = await storeFor().getWithMetadata(key, { type: 'json' });
  if (record && !record.etag) throw new Error('Storage revision unavailable');
  return { data: record?.data ?? null, revision: record?.etag ?? null };
}

export async function writeRecord(key, data, revision) {
  if (process.env.NETLIFY_DEV === 'true') return writeLocal(key, data, revision);
  const options = revision ? { onlyIfMatch: revision } : { onlyIfNew: true };
  const result = await storeFor().setJSON(key, data, options);
  if (!result.modified) throw Object.assign(new Error('This record changed. Reload it before saving again.'), { status: 409 });
  if (!result.etag) throw new Error('Storage revision unavailable');
  return { data, revision: result.etag };
}

/** @template Item, Result
 * @param {Item[]} items
 * @param {(item: Item) => Result | Promise<Result>} callback
 * @param {number} width
 * @returns {Promise<Result[]>}
 */
export async function mapInBatches(items, callback, width = 12) {
  const output = [];
  for (let offset = 0; offset < items.length; offset += width) {
    output.push(...await Promise.all(items.slice(offset, offset + width).map(callback)));
  }
  return output;
}

export async function* recordPages(prefix) {
  for await (const page of storeFor().list({ prefix, paginate: true })) {
    yield page.blobs.map(blob => blob.key);
  }
}

function localPath(key) {
  return resolve(process.cwd(), '.netlify', 'owner-preview', Buffer.from(key).toString('hex') + '.json');
}

async function readLocal(key) {
  try {
    return JSON.parse(await readFile(localPath(key), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { data: null, revision: null };
    throw error;
  }
}

async function writeLocal(key, data, revision) {
  const directory = resolve(process.cwd(), '.netlify', 'owner-preview');
  await mkdir(directory, { recursive: true });
  const file = localPath(key);
  const lockPath = file + '.lock';
  let lock;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { lock = await open(lockPath, 'wx'); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await delay(50);
    }
  }
  if (!lock) throw Object.assign(new Error('Another save is running. Try again.'), { status: 409 });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    const current = await readLocal(key);
    if (current.revision !== (revision ?? null)) throw Object.assign(new Error('This record changed. Reload it before saving again.'), { status: 409 });
    const saved = { data, revision: randomUUID() };
    const handle = await open(temp, 'wx');
    try { await handle.writeFile(JSON.stringify(saved)); } finally { await handle.close(); }
    await rename(temp, file);
    return saved;
  } finally {
    await lock.close();
    await unlink(lockPath);
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export function sameOrigin(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    throw Object.assign(new Error('This request must come from the website.'), { status: 403 });
  }
}
