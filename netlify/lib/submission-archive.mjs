import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readRecord } from './store.mjs';

export const recoveredKey = 'submission-backups/recovered';
const maxJsonBytes = 32 * 1024 * 1024;
const maxArchiveBytes = 3_800_000;

export function submissionBackupKey(env = process.env) {
  const secret = env.RS_BACKUP_KEY?.trim() || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  const key = Buffer.from(secret, 'base64url');
  return key.length === 32 ? key : null;
}

function checkRows(items) {
  if (!Array.isArray(items) || items.some(item => {
    const form = item?.form_name || item?.data?.['form-name'];
    return typeof item?.id !== 'string' || !/^[\w-]{1,100}$/.test(item.id) ||
      typeof item.created_at !== 'string' || !Number.isFinite(Date.parse(item.created_at)) ||
      !item.data || typeof item.data !== 'object' || Array.isArray(item.data) ||
      !['quote-request', 'customer-review'].includes(form);
  })) throw new Error('The archive contains invalid submission records.');
  return items;
}

const authenticationData = (binding, info) => Buffer.from(JSON.stringify(['rs-submissions-v1', binding, info]));

export function sealSubmissionArchive(items, key, binding, info) {
  const source = Buffer.from(JSON.stringify(checkRows(items)), 'utf8');
  if (source.byteLength > maxJsonBytes) throw Object.assign(new Error('The backup exceeds this workspace’s archive size limit.'), { status: 413 });
  const compressed = gzipSync(source);
  if (compressed.byteLength > maxArchiveBytes) throw Object.assign(new Error('The backup exceeds this workspace’s archive size limit.'), { status: 413 });
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(authenticationData(binding, info));
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return { version: 1, info, nonce: nonce.toString('base64url'), ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url') };
}

export function openSubmissionArchive(record, key, binding) {
  try {
    if (!key || record?.version !== 1 || typeof record.ciphertext !== 'string' || record.ciphertext.length > Math.ceil(maxArchiveBytes * 4 / 3)) {
      throw new Error('Unknown archive format.');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.nonce, 'base64url'), { authTagLength: 16 });
    decipher.setAAD(authenticationData(binding, record.info));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
    const compressed = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64url')), decipher.final()]);
    return checkRows(JSON.parse(gunzipSync(compressed, { maxOutputLength: maxJsonBytes }).toString('utf8')));
  } catch {
    throw Object.assign(new Error('The archive could not be opened with the configured backup key.'), { status: 409 });
  }
}

export async function readRecoveredSubmissions(key = submissionBackupKey(), read = readRecord) {
  const { data } = await read(recoveredKey);
  return data ? openSubmissionArchive(data, key, recoveredKey) : [];
}
