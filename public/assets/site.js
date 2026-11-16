import { addRoutePreview } from './route-map.js';
import { addLocationSuggestions } from './us-locations.js';
import { enableReviewCounter } from './review-form.js';

const navigation = document.querySelector('#site-nav');
const menuButton = document.querySelector('.menu-toggle');

function setMenuOpen(isOpen) {
  menuButton.setAttribute('aria-expanded', isOpen);
  menuButton.textContent = isOpen ? 'Close' : 'Menu';
  navigation.toggleAttribute('data-open', isOpen);
}

menuButton.hidden = false;
navigation.setAttribute('data-collapsible', '');
menuButton.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'false';
  setMenuOpen(isOpen);
  if (isOpen) navigation.querySelector('a').focus();
});

navigation.addEventListener('click', event => {
  if (event.target.closest('a')) setMenuOpen(false);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton.offsetWidth && navigation.hasAttribute('data-open')) {
    setMenuOpen(false);
    menuButton.focus();
  }
});

function enhanceQuoteForm() {
  const dialog = document.querySelector('#quote-dialog');
  if (typeof dialog.showModal !== 'function') return;

  const form = document.forms['quote-request'];
  const steps = [...form.querySelectorAll('.quote-step')];
  const progress = [...dialog.querySelectorAll('.quote-progress li')];
  const progressLabel = dialog.querySelector('.quote-progress-label');
  const back = form.querySelector('.quote-back');
  const next = form.querySelector('.quote-next');
  const service = form.elements.service;
  const loadGroups = form.querySelectorAll('[data-load-fields]');
  const locations = addLocationSuggestions(form);
  let activeStep = 0;
  let opener;

  function showStep(index) {
    activeStep = index;
    steps.forEach((step, i) => { step.hidden = i !== index; });
    progress.forEach((item, i) => {
      item.classList.toggle('is-complete', i < index);
      if (i === index) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    progressLabel.textContent = `Step ${index + 1} of ${steps.length} · ${progress[index].textContent}`;
    back.hidden = index === 0;
    next.textContent = index === steps.length - 1 ? 'Send quote request' : 'Continue';
  }

  function updateLoadFields() {
    const visibleGroup = {
      'Vehicle towing or transport': 'vehicle',
      'Equipment hauling': 'freight',
      'Freight or cargo transport': 'freight',
      'Urgent or same-day pickup': 'vehicle',
    }[service.value];
    for (const group of loadGroups) {
      group.hidden = group.dataset.loadFields !== visibleGroup;
      for (const field of group.querySelectorAll('input, select')) field.disabled = group.hidden;
    }
  }

  function setError(field, message) {
    const id = `${field.id}-error`;
    let error = document.getElementById(id);
    if (message && !error) {
      error = document.createElement('p');
      error.className = 'field-error';
      error.id = id;
      field.closest('.field').append(error);
      const descriptions = [field.getAttribute('aria-describedby'), id].filter(Boolean);
      field.setAttribute('aria-describedby', descriptions.join(' '));
    }
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
    if (message) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  }

  function validateStep(step) {
    let firstInvalid;
    for (const field of step.querySelectorAll('input, select, textarea')) {
      const missing = field.validity.valueMissing || (field.required && !field.value.trim());
      const message = missing ? field.dataset.requiredMessage : locations.errorFor(field) || field.validationMessage;
      setError(field, message);
      if (message) firstInvalid ??= field;
    }
    return firstInvalid;
  }

  dialog.append(form);
  form.noValidate = true;
  showStep(0);
  updateLoadFields();
  service.addEventListener('change', updateLoadFields);
  addRoutePreview(form, locations, () => validateStep(steps[0]));

  for (const trigger of document.querySelectorAll('[data-quote]')) {
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      opener = trigger;
      if (trigger.dataset.service) {
        service.value = trigger.dataset.service;
        setError(service, '');
        updateLoadFields();
        showStep(0);
      }
      dialog.showModal();
      locations.prepare();
    });
  }

  dialog.querySelector('.quote-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener.focus({ preventScroll: true }));
  back.addEventListener('click', () => {
    showStep(activeStep - 1);
    steps[activeStep].querySelector('legend').focus();
  });

  form.addEventListener('input', ({ target }) => {
    if (target.hasAttribute('aria-invalid') && target.validity.valid && target.value.trim() && !locations.errorFor(target)) {
      setError(target, '');
    }
  });

  form.addEventListener('submit', event => {
    for (let index = 0; index <= activeStep; index++) {
      const invalid = validateStep(steps[index]);
      if (invalid) {
        event.preventDefault();
        if (index !== activeStep) showStep(index);
        invalid.focus();
        return;
      }
    }
    if (activeStep < steps.length - 1) {
      event.preventDefault();
      showStep(activeStep + 1);
      steps[activeStep].querySelector('legend').focus();
    }
  });
}

enhanceQuoteForm();

const faq = document.querySelector('.faq-list');
document.addEventListener('click', event => {
  if (!faq.contains(event.target)) faq.querySelector('details[open]')?.removeAttribute('open');
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !faq.contains(document.activeElement)) return;
  const openAnswer = faq.querySelector('details[open]');
  if (!openAnswer) return;
  openAnswer.open = false;
  openAnswer.querySelector('summary').focus();
});

function reviewDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : '';
}

const reviewPreviewLength = 220;

function showReviewQuote(card, text, index) {
  const quote = card.querySelector('blockquote');
  const characters = Array.from(text);
  if (characters.length <= reviewPreviewLength) {
    quote.textContent = text;
    return;
  }

  const start = characters.slice(0, reviewPreviewLength).join('');
  const lastSpace = start.lastIndexOf(' ');
  const excerpt = `${lastSpace > reviewPreviewLength * .8 ? start.slice(0, lastSpace) : start}…`;
  quote.id = `review-quote-${index}`;
  quote.textContent = excerpt;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'text-link review-toggle';
  toggle.textContent = 'Read full review';
  toggle.setAttribute('aria-controls', quote.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'false';
    quote.textContent = expanded ? text : excerpt;
    toggle.textContent = expanded ? 'Show less' : 'Read full review';
    toggle.setAttribute('aria-expanded', expanded);
  });
  quote.after(toggle);
}

async function showApprovedReviews() {
  const list = document.querySelector('[data-review-list]');
  const template = document.querySelector('#review-card');
  const slots = [...list.children];
  try {
    const response = await fetch('/assets/reviews.json');
    if (!response.ok) return;
    const entries = await response.json();
    if (!Array.isArray(entries)) return;
    const recent = entries.filter(entry =>
      typeof entry?.quote === 'string' && entry.quote.trim() &&
      typeof entry.name === 'string' && entry.name.trim() &&
      Number.isInteger(entry.rating) && entry.rating >= 1 && entry.rating <= 5)
      .sort((a, b) => reviewDate(b.date).localeCompare(reviewDate(a.date)))
      .slice(0, slots.length);
    for (const [index, entry] of recent.entries()) {
      const card = template.content.cloneNode(true);
      const score = card.querySelector('.review-score');
      const stars = document.createElement('span');
      stars.setAttribute('aria-hidden', 'true');
      stars.textContent = '★'.repeat(entry.rating) + '☆'.repeat(5 - entry.rating);
      const ratingText = document.createElement('span');
      ratingText.className = 'sr-only';
      ratingText.textContent = `${entry.rating} out of 5 stars`;
      score.append(stars, ratingText);
      showReviewQuote(card, entry.quote.trim(), index);
      card.querySelector('.review-author').textContent = entry.name;
      const date = reviewDate(entry.date);
      if (date) {
        const time = card.querySelector('time');
        time.dateTime = date;
        time.textContent = new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        time.hidden = false;
      }
      slots[index].replaceWith(card);
    }
  } catch {
    // The review placeholders and invitation remain available.
  }
}

showApprovedReviews();

function enhanceReviewDialog() {
  const dialog = document.querySelector('#review-dialog');
  if (typeof dialog.showModal !== 'function') return;
  const slot = dialog.querySelector('.review-form-slot');
  let loading;
  let opener;

  async function loadForm(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Review page unavailable');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const form = page.querySelector('form[name="customer-review"]');
      if (!form) throw new Error('Review form unavailable');
      const imported = document.importNode(form, true);
      slot.replaceChildren(imported);
      enableReviewCounter(imported);
    } catch {
      const fallback = document.createElement('a');
      fallback.className = 'text-link';
      fallback.href = url;
      fallback.textContent = 'Open the review form';
      slot.replaceChildren(fallback);
      loading = undefined;
    }
  }

  for (const trigger of document.querySelectorAll('[data-review-open]')) {
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      opener = trigger;
      dialog.showModal();
      loading ??= loadForm(trigger.href);
    });
  }
  dialog.querySelector('.review-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener.focus({ preventScroll: true }));
}

enhanceReviewDialog();

if ('IntersectionObserver' in window && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
  const reveal = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-revealing');
      reveal.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -30px' });

  for (const section of document.querySelectorAll('[data-reveal]')) {
    if (section.getBoundingClientRect().top >= window.innerHeight) reveal.observe(section);
  }
}
