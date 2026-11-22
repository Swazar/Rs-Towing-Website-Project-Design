import { enhanceQuoteForm } from './quote-form.js';
import { contentReady } from './site-content.js';
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
  try {
    const content = await contentReady;
    let entries = content.reviews;
    if (entries === null) {
      const response = await fetch('/assets/reviews.json');
      if (!response.ok) return;
      entries = await response.json();
    }
    if (!Array.isArray(entries)) return;
    const recent = entries.filter(entry =>
      typeof entry?.quote === 'string' && entry.quote.trim() &&
      typeof entry.name === 'string' && entry.name.trim() &&
      Number.isInteger(entry.rating) && entry.rating >= 1 && entry.rating <= 5)
      .sort((a, b) => reviewDate(b.date).localeCompare(reviewDate(a.date)))
      .slice(0, 3);
    list.replaceChildren();
    list.hidden = recent.length === 0;
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
      list.append(card);
    }
  } catch {
    // The invitation remains available when reviews cannot load.
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
