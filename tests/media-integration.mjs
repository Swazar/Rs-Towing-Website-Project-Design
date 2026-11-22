import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
const base = 'http://localhost:8888';
async function request(path, body, origin = base) {
  const response = await fetch(base + '/.netlify/functions/' + path, body ? { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { status: response.status, data: await response.json() };
}
assert.equal((await request('owner?action=session')).data.localPreview, true, 'Only run this integration test locally.');
const source = await readFile('public/assets/flatbed-freight.webp');
const upload = { id: randomUUID(), name: 'LOCAL UPLOAD TEST.webp', alt: 'Blue-wrapped freight secured on a flatbed trailer', data: 'data:image/webp;base64,' + source.toString('base64') };
const uploaded = await request('owner-media', upload); assert.equal(uploaded.status, 200); const image = uploaded.data;
assert.equal((await request('owner-media', upload)).data.id, image.id);
assert.equal((await request('owner-media', upload, 'https://untrusted.example')).status, 403);
assert.equal((await request('owner-media', { ...upload, id: randomUUID(), data: 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64') })).status, 400);
const list = await request('owner-media'); assert.equal(list.data.items.filter(item => item.id === image.id).length, 1);
const draft = await fetch(base + image.src); assert.equal(draft.status, 200); assert.match(draft.headers.get('cache-control'), /private/);
const bytes = await draft.arrayBuffer(); assert.equal((await sharp(Buffer.from(bytes)).metadata()).format, 'webp');
const thumbnail = await fetch(base + image.smallSrc); assert.ok((await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata()).width <= 640);
const original = (await request('owner?action=content')).data;
const changed = { ...original.data, heroImage: { ...image, position: 'center' } };
const save = await request('owner?action=content', { data: changed, revision: original.revision }); assert.equal(save.status, 200);
try {
  const settings = (await request('site-content')).data.settings; assert.equal(settings.heroImage.src, image.src); assert.equal(settings.heroImage.alt, upload.alt);
  assert.ok(!JSON.stringify(settings).includes(upload.name));
  const published = await fetch(base + image.src); assert.match(published.headers.get('cache-control'), /public/);
} finally {
  const restored = await request('owner?action=content', { data: original.data, revision: save.data.revision }); assert.equal(restored.status, 200, 'Restore only if the test still owns the saved revision.');
}
assert.match((await fetch(base + image.src)).headers.get('cache-control'), /private/);
await writeFile('.netlify/media-test-fixture.json', JSON.stringify(image));
console.log('Passed real local upload, image conversion, thumbnails, idempotency, origin checks, type checks, publication, and original-image restore. The labeled test image remains private in the local library.');
