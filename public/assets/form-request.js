import { contentReady } from './site-content.js';

export async function sendForm(form) {
  const { localPreview } = await contentReady;
  const response = await fetch(localPreview ? '/.netlify/functions/local-submission' : form.getAttribute('action'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(new FormData(form)),
  });
  if (response.status === 429) throw new Error('Too many requests from this connection. Wait a minute and try again. Your details are still here.');
  if (!response.ok) throw new Error('Your request could not be confirmed. Please try again. Your details are still here.');
  return localPreview;
}
