import { applyImage, withMediaDefaults } from './site-media.js';

/** @template {keyof HTMLElementTagNameMap} Tag
 * @param {Tag} tag
 * @param {string | number} [text]
 * @param {string} [className]
 * @returns {HTMLElementTagNameMap[Tag]}
 */
export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  svg.setAttribute('class', 'ui-icon'); svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', '/assets/admin-icons.svg#' + name); svg.append(use);
  return svg;
}

export function initials(name) {
  return String(name || 'Customer').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

export function statusLabel(status = 'New') {
  return node('span', status, 'status-label status-' + status.toLowerCase());
}

export function picture(src, alt, className) {
  const img = node('img', undefined, className); img.src = src; img.alt = alt; return img;
}

export function starRating(rating) {
  const stars = node('div', undefined, 'review-stars');
  stars.setAttribute('role', 'img'); stars.setAttribute('aria-label', rating + ' out of 5 stars');
  for (let i = 0; i < 5; i++) {
    const star = icon('star'); if (i < rating) star.classList.add('filled'); stars.append(star);
  }
  return stars;
}

export function emptyState(title, description, iconName = 'inbox') {
  const element = node('div', undefined, 'empty-visual');
  element.append(icon(iconName), node('h3', title), node('p', description)); return element;
}

export function miniSite(settings) {
  settings = withMediaDefaults(settings);
  const preview = node('div', undefined, 'site-mini');
  const brand = node('div', undefined, 'site-mini-brand');
  brand.append(picture('/assets/rs-logo.webp', ''), node('span', settings.businessName));
  const hero = node('div', undefined, 'site-mini-hero');
  const copy = node('div'); copy.append(node('h3', settings.headline), node('p', settings.description), node('span', 'Request a quote', 'preview-cta'));
  const image = picture(settings.heroImage.src, settings.heroImage.alt); applyImage(image, settings.heroImage); hero.append(copy, image);
  preview.append(brand, hero); return preview;
}

export function renderSectionPreview(container, section, settings) {
  settings = withMediaDefaults(settings);
  if (section === 'opening') { container.replaceChildren(miniSite(settings)); return; }
  const sample = node('div', undefined, 'section-sample');
  if (section === 'contact') {
    sample.append(node('p', settings.businessName, 'sample-small'), node('h3', 'Plan your haul'));
    for (const [name, value] of [['phone', settings.phone], ['mail', settings.email], ['map-pin', settings.location], ['clock', settings.hoursNote]]) {
      const row = node('div', undefined, 'sample-contact-row'); row.append(icon(name), node('span', value)); sample.append(row);
    }
    const image = picture(settings.contactImage.src, settings.contactImage.alt, 'sample-contact-photo'); applyImage(image, settings.contactImage); sample.append(image);
  } else if (section === 'availability') {
    sample.append(node('p', settings.location + ' · ' + settings.hoursNote, 'sample-small'), node('h3', settings.headline));
    if (settings.availabilityMessage) {
      sample.append(node('p', settings.availabilityMessage, 'sample-notice'));
      const expired = !settings.availabilityExpires || new Date(settings.availabilityExpires) <= new Date();
      sample.append(node('p', expired ? 'Set a future expiry to show this notice on the website.' : 'Visible until ' + new Date(settings.availabilityExpires).toLocaleString(), 'sample-expiry'));
    } else sample.append(node('p', 'No temporary notice. Your normal operating hours will show.', 'sample-small'));
  } else if (section === 'services') {
    sample.append(node('h3', 'What we move'));
    settings.services.forEach(service => { const row = node('div', undefined, 'sample-service'); row.append(node('h4', service.title), node('p', service.description)); sample.append(row); });
  } else if (section === 'faq') {
    sample.append(node('h3', 'Before you book'));
    settings.faqs.forEach(faq => { const details = node('details', undefined, 'sample-faq'); details.append(node('summary', faq.question || 'Your question'), node('p', faq.answer || 'Your answer')); sample.append(details); });
  } else if (section === 'gallery') {
    sample.append(node('h3', 'On the road'));
    const grid = node('div', undefined, 'sample-gallery');
    settings.gallery.forEach(photo => { const figure = node('figure'), image = picture(photo.src, photo.alt); applyImage(image, photo); figure.append(image, node('figcaption', photo.caption)); grid.append(figure); }); sample.append(grid);
  }
  container.replaceChildren(sample);
}

export function openInvalidSection(form) {
  const field = [...form.elements].find(element => element.willValidate && !element.checkValidity());
  if (!field) return true;
  let section = field.closest('details');
  while (section) { section.open = true; section = section.parentElement?.closest('details'); }
  field.focus(); field.reportValidity(); return false;
}
