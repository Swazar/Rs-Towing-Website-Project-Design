import { ImagePicker, imageField, readImageField } from '../../../public/assets/image-picker.js';
import { originalImages, withMediaDefaults } from '../../../public/assets/site-media.js';
import { node, picture, renderSectionPreview, openInvalidSection } from '../../../public/assets/admin-ui.js';
import { formField as field } from '../components/form-field.ts';

const $ = selector => document.querySelector(selector);
const sectionNames = { opening: 'Opening screen', contact: 'Business & contact', availability: 'Availability notice', services: 'Services', faq: 'Frequently asked questions', gallery: 'Job photos' };

export function createWebsiteEditor({ api, run, announce, openWebsite, isLocalPreview, onPublish }) {
  const contentForm = $('#owner-content-form');
  const imagePicker = new ImagePicker();
  let dirty = false;
  let activeSection = 'opening';
  let content, publishedContent, contentRevision;

  function load(result) {
    content = withMediaDefaults(result.data);
    publishedContent = structuredClone(content);
    contentRevision = result.revision;
    renderContent();
    setDirty(false);
  }

  function setDirty(value) {
    dirty = value;
    $('#content-dirty').textContent = value ? 'You have unpublished changes.' : 'All changes are published.';
    $('#content-publish').disabled = !value; $('#content-discard').disabled = !value;
    document.body.classList.toggle('has-unpublished', value);
  }

  function addContentField(parent, label, name, value, type, max) {
    const entry = field(label, name, value, type, max);
    if (!['availabilityMessage', 'availabilityExpires'].includes(name)) entry.input.required = true;
    if (type === 'textarea' || name === 'headline' || name === 'availabilityMessage') entry.wrapper.classList.add('wide-field');
    parent.append(entry.wrapper); return entry;
  }

  function renderContent() {
    const groups = {
      'content-contact-fields': [['Business name', 'businessName', 80], ['Public phone', 'phone', 25], ['Public email', 'email', 254], ['Based in', 'location', 100], ['Operating hours', 'hoursNote', 80]],
      'content-opening-fields': [['Main headline', 'headline', 120], ['Opening description', 'description', 350], ['Service area', 'serviceArea', 350], ['What happens after a quote request', 'replyExpectation', 350]],
      'content-availability-fields': [['Temporary message (optional)', 'availabilityMessage', 200], ['Expiry (your local time)', 'availabilityExpires', 30]],
    };
    for (const [id, entries] of Object.entries(groups)) {
      const parent = document.getElementById(id); parent.replaceChildren();
      entries.forEach(([label, name, max]) => {
        let value = content[name];
        if (name === 'availabilityExpires' && value) { const time = new Date(value); value = new Date(time.getTime() - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
        addContentField(parent, label, name, value, name === 'availabilityExpires' ? 'datetime-local' : max >= 300 ? 'textarea' : name === 'email' ? 'email' : 'text', max);
      });
    }
    $('#content-opening-fields').prepend(imageField({ key: 'hero', title: 'Homepage photo', value: content.heroImage, original: originalImages.hero, picker: imagePicker, ratio: '1.26' }));
    $('#content-contact-fields').append(imageField({ key: 'contact', title: 'Contact section photo', value: content.contactImage, original: originalImages.contact, picker: imagePicker, ratio: '2' }));
    const serviceFields = $('#content-service-fields'); serviceFields.replaceChildren();
    content.services.forEach((service, index) => { const item = node('div', undefined, 'content-item'); item.append(node('p', 'SERVICE ' + (index + 1), 'content-item-heading')); addContentField(item, 'Service title', 'service-title-' + index, service.title, 'text', 80); addContentField(item, 'Description', 'service-description-' + index, service.description, 'textarea', 350); serviceFields.append(item); });
    renderFaqFields();
    const gallery = $('#content-gallery-fields'), thumbs = $('#gallery-summary-thumbs'); gallery.replaceChildren(); thumbs.replaceChildren();
    content.gallery.forEach((photo, index) => { const item = node('div', undefined, 'gallery-field'); item.append(imageField({ key: 'gallery' + index, title: 'Job photo ' + (index + 1), value: photo, original: originalImages['gallery' + index], picker: imagePicker })); addContentField(item, 'Photo ' + (index + 1) + ' caption', 'gallery-caption-' + index, photo.caption, 'text', 120); gallery.append(item); thumbs.append(picture(photo.src, '')); });
    updateContentPreview();
  }

  function renderFaqFields() {
    const parent = $('#content-faq-fields'); parent.replaceChildren();
    content.faqs.forEach((faq, index) => {
      const item = node('div', undefined, 'content-item'); item.append(node('p', 'QUESTION ' + (index + 1), 'content-item-heading'));
      addContentField(item, 'Question', 'faq-question-' + index, faq.question, 'text', 150); addContentField(item, 'Answer', 'faq-answer-' + index, faq.answer, 'textarea', 600);
      const remove = node('button', 'Remove question', 'quiet-button'); remove.type = 'button'; remove.disabled = content.faqs.length <= 1;
      remove.addEventListener('click', () => { content = readContent(); content.faqs.splice(index, 1); renderFaqFields(); setDirty(true); updateContentPreview(); }); item.append(remove); parent.append(item);
    }); $('#content-add-faq').disabled = content.faqs.length >= 6;
  }

  function readContent() {
    const values = Object.fromEntries(new FormData(contentForm)), result = { ...content };
    for (const key of ['businessName', 'headline', 'description', 'location', 'hoursNote', 'phone', 'email', 'serviceArea', 'replyExpectation', 'availabilityMessage']) result[key] = values[key] ?? content[key];
    result.availabilityExpires = values.availabilityExpires && Number.isFinite(Date.parse(values.availabilityExpires)) ? new Date(values.availabilityExpires).toISOString() : '';
    result.services = content.services.map((service, index) => ({ title: values['service-title-' + index] ?? service.title, description: values['service-description-' + index] ?? service.description }));
    result.faqs = content.faqs.map((faq, index) => ({ question: values['faq-question-' + index] ?? faq.question, answer: values['faq-answer-' + index] ?? faq.answer }));
    result.heroImage = readImageField(contentForm, 'hero', content.heroImage);
    result.contactImage = readImageField(contentForm, 'contact', content.contactImage);
    result.gallery = content.gallery.map((photo, index) => ({ ...readImageField(contentForm, 'gallery' + index, photo), caption: values['gallery-caption-' + index] ?? photo.caption })); return result;
  }

  function updateContentPreview() {
    if (!content) return; const settings = readContent();
    $('#section-preview-title').textContent = sectionNames[activeSection]; renderSectionPreview($('#section-preview'), activeSection, settings);
    const summaries = { opening: settings.headline, contact: [settings.location, settings.hoursNote].filter(Boolean).join(' · '), availability: settings.availabilityMessage || 'No temporary notice', services: settings.services.length + ' services', faq: settings.faqs.length + ' questions & answers', gallery: settings.gallery.length + ' photos & captions' };
    $('#gallery-summary-thumbs').replaceChildren(...settings.gallery.map(photo => picture(photo.smallSrc || photo.src, '')));
    for (const [section, text] of Object.entries(summaries)) document.querySelector('[data-section-summary="' + section + '"]').textContent = text;
  }

  function openEditor(section) {
    openWebsite(); const details = document.querySelector('.editor-section[data-section="' + section + '"]');
    details.open = true; activeSection = section; updateContentPreview(); details.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  document.querySelectorAll('[data-edit-section]').forEach(button => button.addEventListener('click', () => openEditor(button.dataset.editSection)));
  document.querySelectorAll('.editor-section').forEach(details => details.addEventListener('toggle', () => {
    if (!details.open) return;
    document.querySelectorAll('.editor-section').forEach(other => { if (other !== details) other.open = false; }); activeSection = details.dataset.section; updateContentPreview();
  }));
  contentForm.addEventListener('input', () => { setDirty(true); updateContentPreview(); });
  $('#content-add-faq').addEventListener('click', () => { if (content.faqs.length >= 6) return; content = readContent(); content.faqs.push({ question: '', answer: '' }); renderFaqFields(); setDirty(true); updateContentPreview(); });
  contentForm.addEventListener('submit', event => {
    event.preventDefault(); if (!openInvalidSection(contentForm)) return;
    run(event.submitter, async () => {
      const result = await api('content', { data: readContent(), revision: contentRevision });
      content = result.data; publishedContent = structuredClone(content); contentRevision = result.revision;
      setDirty(false); onPublish(result); updateContentPreview(); announce('Website changes published' + (isLocalPreview() ? ' to this local preview.' : '.'));
    }).finally(() => { $('#content-publish').disabled = !dirty; });
  });
  function openFullPreview() {
    const settings = readContent(), frame = $('#content-preview-frame');
    frame.onload = () => frame.contentWindow.postMessage({ type: 'rs-content-preview', settings }, location.origin);
    frame.src = '/?owner-preview=1'; $('#content-preview-dialog').showModal();
  }
  $('#content-preview').addEventListener('click', openFullPreview);
  $('#content-preview-mobile').addEventListener('click', openFullPreview);
  $('#content-preview-close').addEventListener('click', () => $('#content-preview-dialog').close());
  document.querySelectorAll('[data-preview-device]').forEach(button => button.addEventListener('click', () => {
    $('.full-preview-stage').classList.toggle('is-mobile', button.dataset.previewDevice === 'mobile');
    document.querySelectorAll('[data-preview-device]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  }));
  $('#content-discard').addEventListener('click', () => { content = structuredClone(publishedContent); renderContent(); setDirty(false); $('#content-preview-dialog').close(); announce('Draft changes discarded', { tone: 'info', detail: 'Your published website is unchanged.' }); });

  return {
    load,
    get published() { return publishedContent; },
    get hasDraft() { return dirty || imagePicker.isBusy; },
  };
}
