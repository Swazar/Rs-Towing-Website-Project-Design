import { node, icon, picture } from './admin-ui.js';
import { originalImages, imagePositions, applyImage } from './site-media.js';

export function checkImageFile(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose an image smaller than 12 MB.');
}
export async function prepareWebsiteImage(file) {
  checkImageFile(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/webp', .82);
    if (data.length > 2000000) data = canvas.toDataURL('image/webp', .65);
    if (data.length > 2000000) throw new Error('This photo is still too large. Choose a smaller image.');
    if (!data.startsWith('data:image/webp;')) throw new Error('Your browser could not prepare this image. Try another browser.');
    return { data, width: canvas.width, height: canvas.height, name: file.name.slice(0, 140), id: crypto.randomUUID() };
  } finally { bitmap.close(); }
}

function labelledInput(label, id, type = 'text') {
  const field = node('div', undefined, 'field'), caption = node('label', label), input = node(type === 'select' ? 'select' : 'input');
  input.id = id; if (type !== 'select') input.type = type; caption.htmlFor = id; field.append(caption, input); return { field, input };
}
function positionOptions(select) { Object.entries(imagePositions).forEach(([value, label]) => select.add(new Option(label, value))); }
function bindDrop(element, receive) {
  element.addEventListener('dragover', event => { if (!event.dataTransfer?.types?.includes('Files')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; element.classList.add('is-dragging'); });
  element.addEventListener('dragleave', event => { if (!element.contains(event.relatedTarget)) element.classList.remove('is-dragging'); });
  element.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); element.classList.remove('is-dragging');
    const files = [...(event.dataTransfer?.files || [])]; receive(files.length === 1 ? files[0] : null);
  });
}

export class ImagePicker {
  constructor() {
    this.dialog = document.querySelector('#image-picker-dialog'); this.form = document.querySelector('#image-picker-form');
    this.fileInput = document.querySelector('#website-image-file'); this.status = document.querySelector('#image-picker-status');
    this.alt = document.querySelector('#image-picker-alt'); this.position = document.querySelector('#image-picker-position');
    this.preview = document.querySelector('#image-picker-preview'); this.useButton = document.querySelector('#image-picker-use');
    this.progress = document.querySelector('#image-picker-progress'); this.library = document.querySelector('#image-picker-library');
    positionOptions(this.position); this.generation = 0; this.selection = 0; this.libraryRequest = 0;
    document.querySelector('#image-picker-browse').addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => { if (this.fileInput.files[0]) this.acceptFile(this.fileInput.files[0]); });
    bindDrop(document.querySelector('#image-picker-drop'), file => this.acceptFile(file));
    document.querySelectorAll('[data-media-tab]').forEach(button => {
      button.addEventListener('click', () => this.switchTab(button.dataset.mediaTab));
      button.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const next = button.dataset.mediaTab === 'upload' ? 'library' : 'upload'; this.switchTab(next); document.querySelector('[data-media-tab="' + next + '"]').focus(); });
    });
    document.querySelectorAll('[data-close-image-picker]').forEach(button => button.addEventListener('click', () => this.dialog.close()));
    this.dialog.addEventListener('close', () => { this.generation++; this.request?.abort(); this.busy(false); this.prepared = null; this.fileInput.value = ''; });
    this.alt.addEventListener('input', () => this.refreshPreview()); this.position.addEventListener('change', () => this.refreshPreview());
    this.form.addEventListener('submit', event => { event.preventDefault(); this.useImage(); });
    document.querySelector('#image-library-more').addEventListener('click', () => this.loadLibrary(false));
    document.querySelector('#image-library-retry').addEventListener('click', () => this.loadLibrary(true));
    document.addEventListener('dragover', event => { if (event.dataTransfer?.types?.includes('Files')) event.preventDefault(); });
    document.addEventListener('drop', event => { if (event.dataTransfer?.files?.length) event.preventDefault(); });
  }
  async api(options = {}) {
    const response = await fetch('/.netlify/functions/owner-media' + (options.offset ? '?offset=' + options.offset : ''), options.body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body), signal: options.signal,
    } : { signal: options.signal });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The image could not be saved. Try again.'); return result;
  }
  busy(value, message = '') {
    this.isBusy = value; this.useButton.disabled = value; this.fileInput.disabled = value; document.querySelector('#image-picker-browse').disabled = value;
    this.progress.hidden = !value; this.status.textContent = message;
  }
  open({ title, value, ratio, onSelect }, file) {
    this.generation++; this.target = { onSelect, ratio }; this.selected = { ...value }; this.prepared = null;
    document.querySelector('#image-picker-title').textContent = title; this.alt.value = value.alt || ''; this.position.value = value.position || 'center';
    this.preview.style.aspectRatio = ratio; this.busy(false); this.refreshPreview(); this.switchTab('upload'); this.dialog.showModal();
    if (file) this.acceptFile(file);
  }
  switchTab(tab) {
    document.querySelectorAll('[data-media-tab]').forEach(button => { const selected = button.dataset.mediaTab === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
    document.querySelector('#image-picker-upload-panel').hidden = tab !== 'upload'; document.querySelector('#image-picker-library-panel').hidden = tab !== 'library';
    if (tab === 'library' && !this.libraryLoaded) this.loadLibrary(true);
  }
  async acceptFile(file) {
    if (this.isBusy) return;
    const generation = this.generation;
    try {
      if (!file) throw new Error('Drop one image at a time.');
      checkImageFile(file); this.busy(true, 'Preparing your image…');
      const prepared = await prepareWebsiteImage(file); if (generation !== this.generation) return;
      this.prepared = prepared; this.selected = { src: prepared.data, width: prepared.width, height: prepared.height, name: prepared.name };
      this.alt.value = ''; this.position.value = 'center'; this.refreshPreview(); this.busy(false);
      document.querySelector('#image-picker-file-info').textContent = prepared.name + ' · ' + prepared.width + ' × ' + prepared.height + ' px';
      this.alt.focus();
    } catch (error) { if (generation === this.generation) { this.busy(false); this.status.textContent = error.message; } }
  }
  refreshPreview() {
    this.preview.replaceChildren(); if (!this.selected) return;
    const image = picture(this.selected.src, this.alt.value); image.style.objectPosition = this.position.value; this.preview.append(image);
    this.library.querySelectorAll('[data-image-src]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.imageSrc === this.selected.src)));
    const small = this.selected.width && this.selected.width < 1000;
    document.querySelector('#image-picker-resolution').textContent = small ? 'This photo is small. A wider image will look sharper in a large section.' : '';
    document.querySelector('#image-picker-file-info').textContent = this.selected.name || 'Current photo';
  }
  choose(image) {
    if (this.isBusy) return; this.selection++; this.prepared = null; this.selected = { ...image }; this.alt.value = image.alt || ''; this.position.value = image.position || 'center'; this.status.textContent = ''; this.refreshPreview();
  }
  async loadLibrary(reset) {
    const generation = this.generation, request = ++this.libraryRequest;
    const more = document.querySelector('#image-library-more'), retry = document.querySelector('#image-library-retry'), info = document.querySelector('#image-library-status');
    more.disabled = true; retry.hidden = true; info.textContent = 'Loading your images…';
    if (reset) {
      this.library.replaceChildren(); const originals = node('div', undefined, 'image-library-grid');
      for (const [key, name] of [['hero', 'Original homepage photo'], ['gallery0', 'Equipment transport'], ['gallery1', 'Flatbed freight']]) {
        originals.append(this.libraryTile({ ...originalImages[key], name }));
      }
      this.library.append(node('h3', 'Original photos'), originals, node('h3', 'Your uploads')); this.offset = 0;
    }
    try {
      const result = await this.api({ offset: reset ? 0 : this.nextOffset }); if (generation !== this.generation || request !== this.libraryRequest) return;
      let uploads = this.library.querySelector('.uploaded-images');
      if (!uploads) { uploads = node('div', undefined, 'image-library-grid uploaded-images'); this.library.append(uploads); }
      result.items.forEach(image => uploads.append(this.libraryTile(image)));
      this.nextOffset = result.nextOffset; this.libraryLoaded = true; more.hidden = result.nextOffset === null;
      info.textContent = !uploads.children.length ? 'No uploads yet. Add a photo using the Upload tab.' : '';
      this.refreshPreview();
    } catch (error) { info.textContent = error.message; retry.hidden = false; more.hidden = true; }
    finally { if (request === this.libraryRequest) more.disabled = false; }
  }
  libraryTile(image) {
    const button = node('button', undefined, 'image-library-tile'); button.type = 'button'; button.dataset.imageSrc = image.src; button.setAttribute('aria-pressed', 'false');
    const thumbnail = picture(image.smallSrc || image.src, ''); thumbnail.loading = 'lazy';
    button.append(thumbnail, node('span', image.name || 'Uploaded photo')); button.addEventListener('click', () => this.choose(image)); return button;
  }
  async useImage() {
    if (this.isBusy || !this.selected) return;
    if (!this.alt.value.trim()) { this.alt.setCustomValidity('Briefly describe what is in the photo.'); this.alt.reportValidity(); this.alt.setCustomValidity(''); return; }
    const generation = this.generation, onSelect = this.target.onSelect;
    this.request = new AbortController(); this.busy(true, this.prepared ? 'Uploading your image…' : 'Applying image…');
    try {
      const image = this.prepared ? await this.api({ body: { ...this.prepared, alt: this.alt.value.trim() }, signal: this.request.signal }) : this.selected;
      if (generation !== this.generation || !this.dialog.open) return;
      const selection = { ...image, alt: this.alt.value.trim(), position: this.position.value };
      if (this.prepared) this.libraryLoaded = false;
      onSelect(selection); this.dialog.close();
    } catch (error) { if (generation === this.generation) { this.busy(false); this.status.textContent = error.name === 'AbortError' ? 'Upload cancelled.' : error.message; } }
  }
}

export function imageField({ key, title, value, original, picker, ratio = '1.6' }) {
  const field = node('div', undefined, 'website-image-field'); field.append(node('p', title, 'media-field-title'));
  const preview = node('div', undefined, 'website-image-current'); preview.style.aspectRatio = ratio;
  const image = picture(value.src, value.alt); applyImage(image, value); preview.append(image);
  const hidden = node('input'); hidden.type = 'hidden'; hidden.name = 'media-' + key; hidden.value = JSON.stringify(value);
  const actions = node('div', undefined, 'media-field-actions'), change = node('button', undefined, 'button button-outline'); change.type = 'button'; change.append(icon('image'), node('span', 'Change image'));
  change.setAttribute('aria-label', 'Change ' + title.toLowerCase());
  const restore = node('button', 'Restore original', 'quiet-button'); restore.type = 'button'; restore.hidden = value.src === original.src;
  const detail = node('details', undefined, 'media-image-details'); detail.append(node('summary', 'Image details'));
  const alt = labelledInput('Image description', 'media-' + key + '-alt'); alt.input.name = 'media-' + key + '-alt'; alt.input.value = value.alt; alt.input.required = true; alt.input.maxLength = 180;
  const position = labelledInput('Image alignment', 'media-' + key + '-position', 'select'); position.input.name = 'media-' + key + '-position'; positionOptions(position.input); position.input.value = value.position || 'center';
  detail.append(alt.field, node('p', 'Describe the photo for people using a screen reader.', 'field-hint'), position.field);
  function current() { return { ...JSON.parse(hidden.value), alt: alt.input.value, position: position.input.value }; }
  function select(next) { hidden.value = JSON.stringify(next); alt.input.value = next.alt; position.input.value = next.position || 'center'; applyImage(image, next); restore.hidden = next.src === original.src; hidden.dispatchEvent(new Event('input', { bubbles: true })); }
  function open(file) { picker.open({ title, value: current(), ratio, onSelect: select }, file); }
  change.addEventListener('click', () => open()); restore.addEventListener('click', () => select({ ...original }));
  bindDrop(preview, file => { if (file) open(file); else { open(); picker.status.textContent = 'Drop one image at a time.'; } });
  alt.input.addEventListener('input', () => { image.alt = alt.input.value; }); position.input.addEventListener('change', () => { image.style.objectPosition = position.input.value; });
  actions.append(change, restore); field.append(preview, actions, node('p', 'Drop a photo onto the preview, or choose Change image.', 'field-hint media-desktop-hint'), detail, hidden); return field;
}
export function readImageField(form, key, fallback) {
  const value = form.elements['media-' + key]; if (!value) return fallback;
  let image; try { image = JSON.parse(value.value); } catch { return fallback; }
  return { ...image, alt: form.elements['media-' + key + '-alt'].value, position: form.elements['media-' + key + '-position'].value };
}
