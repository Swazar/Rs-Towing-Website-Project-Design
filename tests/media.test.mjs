import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { defaults } from '../public/assets/business-defaults.js';
import { publishedWebsiteContent, upgradeHaulingContent } from '../netlify/lib/website-content.mjs';
import { originalImages, imageId, mediaSrc, withMediaDefaults } from '../public/assets/site-media.js';
import { checkImageFile } from '../public/assets/image-picker.js';
import { validateSettings } from '../netlify/lib/validation.mjs';
import { saveImage, resolveSettingsImages } from '../netlify/lib/media.mjs';
import { readRecord, writeRecord } from '../netlify/lib/store.mjs';
import siteImage from '../netlify/functions/site-image.mjs';
import siteContent from '../netlify/functions/site-content.mjs';

test('image selection accepts only supported formats and safe image references', () => {
  assert.throws(() => checkImageFile({ type: 'application/pdf', size: 10 }), /JPG/);
  assert.throws(() => checkImageFile({ type: 'image/png', size: 13 * 1024 * 1024 }), /12 MB/);
  assert.doesNotThrow(() => checkImageFile({ type: 'image/webp', size: 5000 }));
  assert.equal(imageId('https://other.example/image'), null);
  const src = mediaSrc(randomUUID()); assert.ok(imageId(src)); assert.equal(imageId(src + '&extra=1'), null);
  const invalid = structuredClone(defaults); invalid.heroImage.position = 'url(unsafe)'; assert.throws(() => validateSettings(invalid), /alignment/);
  const uploaded = withMediaDefaults({ ...defaults, heroImage: { src, alt: 'New photo', position: 'left' } });
  assert.equal(uploaded.heroImage.smallSrc, undefined, 'A new photo must not retain the original image srcset.');
  const legacy = { ...defaults }; delete legacy.heroImage; delete legacy.contactImage;
  assert.equal(withMediaDefaults(legacy).heroImage.src, originalImages.hero.src);
});

test('uploads strip metadata, resize, stay private until publication, and support idempotent retries', async () => {
  const previous = process.cwd(), previousDev = process.env.NETLIFY_DEV;
  const directory = await mkdtemp(resolve(tmpdir(), 'rs-media-test-'));
  process.chdir(directory); process.env.NETLIFY_DEV = 'true';
  try {
    const input = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: '#ac2632' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const id = randomUUID(), body = { id, name: 'LOCAL TEST photo.jpg', alt: 'A local test image', data: 'data:image/jpeg;base64,' + input.toString('base64') };
    const image = await saveImage(body, { id: 'test-owner' }); assert.equal(image.width, 1152); assert.equal(image.height, 1920);
    const raw = (await readRecord('media/' + id)).data, decoded = await sharp(Buffer.from(raw.data, 'base64')).metadata();
    assert.equal(decoded.format, 'webp'); assert.equal(decoded.exif, undefined); assert.equal(decoded.orientation, undefined);
    assert.equal((await saveImage(body, { id: 'test-owner' })).id, id); assert.equal((await readRecord('media-index')).data.length, 1);
    await assert.rejects(() => saveImage(body, { id: 'another-owner' }), /already exists/);
    await assert.rejects(() => saveImage({ ...body, id: randomUUID(), data: 'data:image/png;base64,' + Buffer.from('<svg/>').toString('base64') }, { id: 'test-owner' }), /supported photo/);
    const anonymousURL = 'https://example.test' + image.src;
    assert.equal((await siteImage(new Request(anonymousURL))).status, 404);
    const ownerPreview = await siteImage(new Request('http://localhost:8888' + image.src)); assert.equal(ownerPreview.status, 200); assert.match(ownerPreview.headers.get('cache-control'), /private/);
    const settings = validateSettings({ ...defaults, heroImage: { ...image, alt: 'Published test photo', position: 'center' } });
    const resolved = await resolveSettingsImages(settings); assert.equal(resolved.heroImage.width, 1152);
    await writeRecord('settings', resolved, null);
    const published = await siteImage(new Request(anonymousURL)); assert.equal(published.status, 200); assert.equal(published.headers.get('content-type'), 'image/webp'); assert.match(published.headers.get('cache-control'), /public/);
    const publicJSON = await (await siteContent(new Request('https://example.test'))).json();
    assert.equal(publicJSON.settings.heroImage.src, image.src); assert.ok(!JSON.stringify(publicJSON).includes('LOCAL TEST photo.jpg')); assert.ok(!JSON.stringify(publicJSON).includes(raw.data));
    const stale = await resolveSettingsImages(validateSettings({ ...defaults, heroImage: { ...image, src: mediaSrc(randomUUID()), alt: 'Missing photo', position: 'center' } })).catch(error => error);
    assert.equal(stale.status, 400);
  } finally {
    process.chdir(previous); if (previousDev === undefined) delete process.env.NETLIFY_DEV; else process.env.NETLIFY_DEV = previousDev;
    const target = resolve(directory), parent = resolve(tmpdir());
    if (dirname(target) === parent && basename(target).startsWith('rs-media-test-')) await rm(target, { recursive: true, force: true });
  }
});

test('old saved website versions show hauling services while preserving owner edits and private history', () => {
  const saved = structuredClone(defaults);
  saved.headline = 'Towing & hauling across North Carolina';
  saved.services[0] = { title: 'Vehicle towing & transport', description: 'Call our dispatcher before arrival.' };
  saved.contactImage = { src: '/assets/towing-stock.webp', alt: 'Retired stock image', position: 'center' };
  saved.gallery[1] = { ...saved.contactImage, caption: 'Retired stock image' };
  saved.faqs[1] = { question: 'Can you move a vehicle that won’t start?', answer: 'Yes. Tell us if the vehicle can roll, steer, and brake so we can plan the pickup.' };
  saved.history = [{ subject: 'Private change' }];
  const current = publishedWebsiteContent(saved);
  assert.equal(current.headline, defaults.headline);
  assert.equal(current.services[0].title, 'Scheduled vehicle hauling');
  assert.equal(current.services[0].description, saved.services[0].description);
  assert.deepEqual(current.faqs[1], defaults.faqs[1]);
  assert.equal(current.contactImage.src, originalImages.contact.src);
  assert.deepEqual(current.gallery[1], defaults.gallery[1]);
  assert.equal(current.history, undefined);
  assert.equal(saved.contactImage.src, '/assets/towing-stock.webp');
  assert.doesNotThrow(() => validateSettings(upgradeHaulingContent(saved)));
});
