import { defaults } from './business-defaults.js';
import { withMediaDefaults, applyImage, originalImages } from './site-media.js';

export const contentReady = fetch('/.netlify/functions/site-content')
  .then(response => {
    if (!response.ok) throw new Error('Saved content unavailable');
    return response.json();
  })
  .catch(() => ({ settings: defaults, reviews: null, localPreview: ['localhost', '127.0.0.1'].includes(location.hostname) }));

export function applyContent(settings, root = document) {
  settings = withMediaDefaults(settings);
  applyImage(root.querySelector('.hero-image'), settings.heroImage);
  applyImage(root.querySelector('.help-photo img'), settings.contactImage);
  const credit = root.querySelector('.help-photo figcaption');
  if (credit) credit.hidden = settings.contactImage.src !== originalImages.contact.src;
  for (const field of ['headline', 'description', 'serviceArea']) {
    root.querySelectorAll(`[data-content="${field}"]`).forEach(node => { node.textContent = settings[field]; });
  }
  root.querySelectorAll('.brand span, .site-footer strong').forEach(node => { node.textContent = settings.businessName; });
  const kicker = root.querySelector('.hero-kicker');
  if (kicker) kicker.textContent = [settings.location, settings.hoursNote].filter(Boolean).join(' · ');
  root.querySelectorAll('a[href^="tel:"]').forEach(link => { link.href = 'tel:' + settings.phone; });
  root.querySelectorAll('a[href^="sms:"]').forEach(link => {
    const message = link.href.split('?')[1];
    link.href = 'sms:' + settings.phone + (message ? '?' + message : '');
  });
  root.querySelectorAll('a[href^="mailto:"]').forEach(link => { link.href = 'mailto:' + settings.email; });
  const phoneText = root.querySelector('#tow-help strong + span');
  const digits = settings.phone.replace(/\D/g, '');
  const displayPhone = digits.length === 11 && digits.startsWith('1')
    ? `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}` : settings.phone;
  if (phoneText) phoneText.textContent = [settings.hoursNote, displayPhone].filter(Boolean).join(' · ');
  root.querySelectorAll('.header-number').forEach(node => { node.textContent = displayPhone; });
  root.querySelectorAll('a[href^="tel:"]').forEach(link => {
    if (/^Call [\d(+]/.test(link.textContent)) link.textContent = 'Call ' + displayPhone;
  });
  const footer = root.querySelector('.site-footer .footer-inner > div > p');
  if (footer) footer.textContent = settings.location + ' · USDOT 4238566';
  const description = root.querySelector('meta[name="description"]');
  if (description && root.querySelector('.hero')) description.content = settings.description;
  root.querySelectorAll('.service-row').forEach((row, index) => {
    if (!settings.services[index]) return;
    row.querySelector('h3').textContent = settings.services[index].title;
    row.querySelector('p').textContent = settings.services[index].description;
  });
  root.querySelectorAll('.work-grid figure').forEach((figure, index) => {
    const item = settings.gallery[index];
    if (item) {
      applyImage(figure.querySelector('img'), item);
      figure.querySelector('figcaption').textContent = item.caption;
    }
  });
  const faq = root.querySelector('.faq-list');
  if (faq) faq.replaceChildren(...settings.faqs.map(item => {
    const details = document.createElement('details');
    details.name = 'site-faq';
    const summary = document.createElement('summary');
    const answer = document.createElement('p');
    summary.textContent = item.question;
    answer.textContent = item.answer;
    details.append(summary, answer);
    return details;
  }));
  let notice = root.querySelector('.availability-notice');
  if (!notice && kicker) {
    notice = document.createElement('p');
    notice.className = 'availability-notice';
    kicker.after(notice);
  }
  if (notice) {
    notice.textContent = settings.availabilityMessage;
    notice.hidden = !settings.availabilityMessage || !settings.availabilityExpires || new Date(settings.availabilityExpires) <= new Date();
  }
  root.querySelectorAll('[data-reply-expectation]').forEach(node => { node.textContent = settings.replyExpectation; });
}

contentReady.then(({ settings, localPreview }) => {
  applyContent(settings);
  document.querySelectorAll('.local-preview-note').forEach(node => { node.hidden = !localPreview; });
});

if (new URLSearchParams(location.search).has('owner-preview')) {
  window.addEventListener('message', async event => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'rs-content-preview') return;
    await contentReady;
    applyContent(event.data.settings);
  });
}
