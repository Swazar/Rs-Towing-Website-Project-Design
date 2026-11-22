import { validateSubmission } from '../lib/validation.mjs';

export const config = {
  path: ['/quote-sent', '/quote-sent/', '/review-sent', '/review-sent/'],
  rateLimit: { action: 'rate_limit', windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

export default async function formTraffic(request, context) {
  if (request.method !== 'POST') return;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Submit the form from the website.', { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
    return new Response('Check the submitted form format.', { status: 415 });
  }
  const maxBytes = 48 * 1024;
  if (Number(request.headers.get('content-length')) > maxBytes) return new Response('Form is too large.', { status: 413 });
  const reader = request.clone().body?.getReader();
  if (!reader) return new Response('Check the submitted form.', { status: 400 });
  let size = 0, raw = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        // Do not wait for the unread branch of the cloned stream.
        void reader.cancel().catch(() => {});
        return new Response('Form is too large.', { status: 413 });
      }
      raw += decoder.decode(value, { stream: true });
    }
    const data = Object.fromEntries(new URLSearchParams(raw + decoder.decode()));
    const expectedForm = new URL(request.url).pathname.startsWith('/quote-sent') ? 'quote-request' : 'customer-review';
    if (data['form-name'] !== expectedForm) throw new Error('Unexpected form');
    validateSubmission(data);
  } catch {
    return new Response('Check the submitted form and try again.', { status: 400 });
  }
  return context.next(request);
}
