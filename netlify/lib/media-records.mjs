import { readRecord } from './store.mjs';
import { builtinImage, imageId, mediaSrc } from '../../public/assets/site-media.js';

export function assetMetadata(record) {
  return { id: record.id, src: mediaSrc(record.id), smallSrc: mediaSrc(record.id) + '&size=small', width: record.width, height: record.height, smallWidth: record.smallWidth,
    bytes: record.bytes, name: record.name, alt: record.alt, createdAt: record.createdAt };
}

export async function resolveSettingsImages(settings) {
  const ids = [...new Set([settings.heroImage, settings.contactImage, ...settings.gallery].map(image => imageId(image.src)).filter(Boolean))];
  const records = new Map(await Promise.all(ids.map(async id => [id, (await readRecord('media/' + id)).data])));
  function resolve(image) {
    const native = builtinImage(image.src);
    if (native) return { ...native, ...image };
    const record = records.get(imageId(image.src));
    if (!record) throw Object.assign(new Error('One of these images is no longer available. Choose another image.'), { status: 400 });
    return { src: image.src, smallSrc: mediaSrc(record.id) + '&size=small', width: record.width, height: record.height, smallWidth: record.smallWidth, alt: image.alt, position: image.position, ...(image.caption ? { caption: image.caption } : {}) };
  }
  return { ...settings, heroImage: resolve(settings.heroImage), contactImage: resolve(settings.contactImage), gallery: settings.gallery.map(resolve) };
}
