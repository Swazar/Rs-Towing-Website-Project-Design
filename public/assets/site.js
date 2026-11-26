import { adaptServiceList } from './service-list.js';
import { enhanceQuoteForm } from './quote-form.js';
import { contentReady } from './site-content.js';
import { enableReviewCounter } from './review-form.js';
import { renderPublishedReviews } from './public-reviews.js';

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
  const link = event.target.closest('a');
  if (!link || !navigation.hasAttribute('data-open')) return;
  setMenuOpen(false);
  const heading = document.querySelector(link.hash)?.querySelector('h2');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton.offsetWidth && navigation.hasAttribute('data-open')) {
    setMenuOpen(false);
    menuButton.focus();
  }
});

window.matchMedia('(max-width: 760px)').addEventListener('change', () => setMenuOpen(false));
adaptServiceList(document.querySelector('.service-list'));
enhanceQuoteForm();

const dispatchActions = document.querySelector('.dispatch-actions');
if (dispatchActions && 'ResizeObserver' in window) {
  new ResizeObserver(() => {
    const height = dispatchActions.offsetHeight;
    if (height) document.documentElement.style.setProperty('--dispatch-height', height + 'px');
  }).observe(dispatchActions);
}

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

async function showApprovedReviews() {
  try {
    const content = await contentReady;
    let entries = content.reviews;
    if (entries === null) {
      const response = await fetch('/assets/reviews.json');
      if (!response.ok) return;
      entries = await response.json();
    }
    if (Array.isArray(entries)) renderPublishedReviews(entries, {
      list: document.querySelector('[data-review-list]'),
      template: document.querySelector('#review-card'),
    });
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
