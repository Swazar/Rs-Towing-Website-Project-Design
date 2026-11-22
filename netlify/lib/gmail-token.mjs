import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { reconnectGmail } from './gmail-account.mjs';

export function protectGmailToken(key, binding, token) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(binding));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { version: 1, nonce: nonce.toString('base64url'), ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
}

export function openGmailToken(key, binding, record) {
  try {
    if (record?.version !== 1) throw new Error('Unknown token format.');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.nonce, 'base64url'), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw reconnectGmail();
  }
}
