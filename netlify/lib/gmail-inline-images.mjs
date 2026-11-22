const imageTypes = new Map([
  ['image/png', bytes => bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'],
  ['image/jpeg', bytes => bytes.subarray(0, 3).toString('hex') === 'ffd8ff'],
  ['image/gif', bytes => /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))],
  ['image/webp', bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'],
]);
const maxImageBytes = 240_000;
const reference = / data-mail-cid="(\d+)"/g;

export function inlineImagePart(type, body) {
  if (!imageTypes.has(type)) return null;
  const data = typeof body?.data === 'string' ? body.data : '';
  const attachmentId = typeof body?.attachmentId === 'string' && /^[\w-]{1,1024}$/.test(body.attachmentId) ? body.attachmentId : '';
  const size = data ? Math.ceil(data.length * 3 / 4) : body?.size;
  if ((!data && !attachmentId) || !Number.isSafeInteger(size) || size < 1 || size > maxImageBytes) return null;
  return { type, data, attachmentId, size };
}

export async function loadInlineImages(formatted, images, budget, fetchAttachment) {
  if (!formatted || !images.size) return formatted;
  const references = new Map();
  for (const [, index] of formatted.html.matchAll(reference)) {
    references.set(Number(index), (references.get(Number(index)) ?? 0) + 1);
  }
  // Count repeated references toward the response budget before fetching anything.
  const selected = [...images.values()].filter(image => {
    const charge = image.size * (references.get(image.index) ?? 0);
    if (!charge || budget.count <= 0 || charge > budget.bytes) return false;
    budget.count--;
    budget.bytes -= charge;
    return true;
  });
  const sources = new Map(await Promise.all(selected.map(async image => {
    let data = image.data;
    if (!data) {
      try { data = (await fetchAttachment(image.attachmentId)).data; }
      catch { return [image.index, '']; }
    }
    if (typeof data !== 'string' || data.length > Math.ceil(image.size / 3) * 4 || !/^[\w-]+={0,2}$/.test(data)) return [image.index, ''];
    const bytes = Buffer.from(data, 'base64url');
    if (bytes.length > image.size || !imageTypes.get(image.type)(bytes)) return [image.index, ''];
    return [image.index, 'data:' + image.type + ';base64,' + bytes.toString('base64')];
  })));
  const html = formatted.html.replace(reference, (attribute, index) => {
    const src = sources.get(Number(index));
    return src ? ' decoding="async" src="' + src + '"' : attribute;
  });
  return { ...formatted, html };
}
