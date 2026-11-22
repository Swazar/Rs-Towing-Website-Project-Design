import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readRecord, writeRecord } from './store.mjs';
import { text } from './validation.mjs';
import { mediaIdPattern } from '../../public/assets/site-media.js';
import { assetMetadata } from './media-records.mjs';
export { resolveSettingsImages } from './media-records.mjs';

function imageBytes(data) {
  if (typeof data !== 'string' || data.length > 2100000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(data)) throw Object.assign(new Error('Choose a JPG, PNG, or WebP image.'), { status: 400 });
  const bytes = Buffer.from(data.split(',')[1], 'base64');
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!jpeg && !png && !webp) throw Object.assign(new Error('This file is not a supported photo.'), { status: 400 });
  return bytes;
}

export async function saveImage(body, actor) {
  if (!body || typeof body !== 'object') throw Object.assign(new Error('Choose an image to upload.'), { status: 400 });
  if (!mediaIdPattern.test(body.id || '')) throw Object.assign(new Error('Start the upload again.'), { status: 400 });
  const bytes = imageBytes(body.data), digest = createHash('sha256').update(bytes).digest('hex');
  const existing = await readRecord('media/' + body.id);
  let record = existing.data;
  if (record && (record.uploadedBy !== actor.id || record.digest !== digest)) throw Object.assign(new Error('This upload already exists. Choose the image again.'), { status: 409 });
  if (!record) {
    let full, small;
    try {
      const pipeline = sharp(bytes, { limitInputPixels: 40000000, failOn: 'warning' }).rotate();
      const metadata = await pipeline.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Unsupported format');
      [full, small] = await Promise.all([
        pipeline.clone().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true }),
        pipeline.clone().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toBuffer({ resolveWithObject: true }),
      ]);
    } catch { throw Object.assign(new Error('This image could not be read. Choose another JPG, PNG, or WebP photo.'), { status: 400 }); }
    if (full.data.length > 1100000) throw Object.assign(new Error('This image is too large after resizing. Choose a smaller photo.'), { status: 400 });
    record = { id: body.id, digest, data: full.data.toString('base64'), smallData: small.data.toString('base64'), width: full.info.width, height: full.info.height, smallWidth: small.info.width,
      bytes: full.data.length, name: text(body.name || 'Uploaded photo', 140, 'file name', true), alt: text(body.alt, 180, 'image description', true), uploadedBy: actor.id, createdAt: new Date().toISOString() };
    await writeRecord('media/' + body.id, record, null);
  }
  const metadata = assetMetadata(record);
  for (let attempt = 0; attempt < 4; attempt++) {
    const index = await readRecord('media-index'), items = index.data || [];
    if (items.some(item => item.id === record.id)) return metadata;
    if (items.length >= 1000) throw Object.assign(new Error('Your image library is full.'), { status: 400 });
    try { await writeRecord('media-index', [metadata, ...items], index.revision); return metadata; }
    catch (error) { if (error.status !== 409 || attempt === 3) throw error; }
  }
}
