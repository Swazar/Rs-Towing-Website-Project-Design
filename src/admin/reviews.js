import { icon, node } from '../../public/assets/admin-ui.js';
import { homepageReviewLimit, renderReviewQuote } from '../../public/assets/public-reviews.js';
import { businessDateKey } from '../domain/jobs/dates.ts';

const feedbackId = id => 'review-feedback-' + id;
const emptyMessages = {
  ready: 'No reviews are ready to show.',
  private: 'No private feedback yet.',
  spam: 'No reviews marked as spam.',
};

function feedbackCategory(item) {
  if (item.state?.publication === 'Spam') return 'spam';
  return item.data['publish-permission'] === 'yes' ? 'ready' : 'private';
}

const ratingIsValid = value => Number.isInteger(value) && value >= 1 && value <= 5;
const monthLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });
const monthDescription = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });

function reviewRating(rating) {
  if (!ratingIsValid(rating)) return node('span', 'No rating', 'review-rating-unavailable');
  const stars = node('span', undefined, 'review-rating');
  stars.setAttribute('role', 'img');
  stars.setAttribute('aria-label', rating + ' out of 5 stars');
  for (let position = 1; position <= 5; position++) {
    const star = icon('star');
    star.classList.toggle('is-filled', position <= rating);
    stars.append(star);
  }
  return stars;
}

function renderRatingSummary(panel, reviews) {
  const rated = reviews.filter(review => ratingIsValid(review.rating));
  const average = rated.reduce((sum, review) => sum + review.rating, 0) / rated.length;
  panel.querySelector('#review-average-score').textContent = rated.length ? average.toFixed(1) : '—';
  panel.querySelector('#review-average-scale').hidden = !rated.length;
  const description = rated.length
    ? rated.length + (rated.length === 1 ? ' rating' : ' ratings') + ' · All time'
    : 'No ratings yet';
  panel.querySelector('#review-average-count').textContent = description;

  const [year, month] = businessDateKey().split('-').map(Number);
  const months = Array.from({ length: 6 }, (_, index) =>
    new Date(Date.UTC(year, month - 6 + index, 1)));
  const counts = new Map(months.map(date => [date.toISOString().slice(0, 7), 0]));
  for (const review of rated) {
    const day = review.submittedAt ? businessDateKey(new Date(review.submittedAt)) : review.date;
    const key = day?.slice(0, 7);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  const peak = Math.max(1, ...counts.values());
  const bars = months.map(date => {
    const count = counts.get(date.toISOString().slice(0, 7));
    const entry = node('li');
    const label = node('span', monthLabel.format(date), 'review-trend-month');
    const value = node('span', count, 'review-trend-value');
    const track = node('span', undefined, 'review-trend-track');
    const bar = node('span', undefined, 'review-trend-bar');
    bar.style.height = (count * 100 / peak) + '%';
    for (const visual of [label, value, track]) visual.setAttribute('aria-hidden', 'true');
    track.append(bar);
    entry.append(node('span', monthDescription.format(date) + ', ' + count + (count === 1 ? ' review' : ' reviews'), 'sr-only'), value, track, label);
    return entry;
  });
  panel.querySelector('#review-trend-months').replaceChildren(...bars);
}

export class ReviewWorkspace {
  constructor(panel, { date, save, refresh, announce }) {
    this.panel = panel;
    this.date = date;
    this.save = save;
    this.refresh = refresh;
    this.announce = announce;
    this.list = panel.querySelector('#owner-review-list');
    this.filters = [...panel.querySelectorAll('[data-review-category]')];
    this.search = panel.querySelector('#review-search');
    this.note = panel.querySelector('#review-list-note');
    this.slots = panel.querySelector('#review-homepage-slots');
    this.slotStatus = panel.querySelector('#review-slots-status');
    this.slotTitle = panel.querySelector('#review-homepage-title');
    this.current = 'ready';
    this.groups = { ready: [], homepage: [], private: [], spam: [] };
    this.filters.forEach(button => button.addEventListener('click', () => this.setFilter(button.dataset.reviewCategory)));
    this.search.addEventListener('input', () => this.renderList());
    document.addEventListener('click', event => {
      const open = this.list.querySelector('.review-more[open]');
      if (open && !open.contains(event.target)) open.open = false;
    });
  }

  setFilter(category) {
    this.current = category;
    this.search.value = '';
    this.render();
  }

  openReview(id) {
    const category = Object.keys(this.groups).find(key => this.groups[key].some(review => review.id === id));
    if (category !== 'homepage') this.setFilter(category ?? 'ready');
    this.focusFeedback(id);
  }

  focusFeedback(id) {
    (document.getElementById(feedbackId(id)) ??
      this.filters.find(button => button.dataset.reviewCategory === this.current))?.focus();
  }

  focusSlot() {
    (this.slots.querySelector('.review-slot-add') ?? this.slotTitle).focus();
  }

  chooseReview() {
    this.setFilter('ready');
    (this.list.querySelector('[data-add-review]') ??
      this.filters.find(button => button.dataset.reviewCategory === 'ready')).focus();
  }

  load(items, homepage) {
    const visibleIds = new Set(homepage.map(review => review.id));
    const byId = new Map(items.map(item => [item.id, item]));
    this.groups = {
      ready: [],
      homepage: homepage.map((review, slot) => ({ ...review, slot, submittedAt: byId.get(review.id)?.created_at })),
      private: [],
      spam: [],
    };
    for (const item of items) {
      if (visibleIds.has(item.id)) continue;
      this.groups[feedbackCategory(item)].push({
        id: item.id,
        revision: item.revision,
        name: item.data.first_name || 'Customer',
        quote: item.data.review,
        rating: Number(item.data.rating),
        submittedAt: item.created_at,
      });
    }
    renderRatingSummary(this.panel, [...this.groups.ready, ...this.groups.homepage, ...this.groups.private]);
    this.renderSlots();
    this.render();
  }

  render() {
    for (const button of this.filters) {
      const category = button.dataset.reviewCategory;
      button.setAttribute('aria-pressed', String(category === this.current));
      button.querySelector('.review-category-count').textContent = this.groups[category].length;
    }
    const full = this.groups.homepage.length >= homepageReviewLimit;
    const note = this.current === 'private' ? 'These customers did not agree to have their feedback published.'
      : this.current === 'ready' && full ? 'Remove a homepage review above to make room for another.' : '';
    this.note.textContent = note;
    this.note.hidden = !note;
    this.renderList();
  }

  renderSlots() {
    const selected = this.groups.homepage;
    const count = selected.length + ' of ' + homepageReviewLimit + ' slots filled.';
    this.slotStatus.textContent = count + (selected.length === homepageReviewLimit
      ? ' Remove a review to make room.'
      : ' Use an empty slot to add a review.');
    const slots = Array.from({ length: homepageReviewLimit }, (_, index) => {
      const review = selected[index];
      const slot = node('li', undefined, 'review-slot');
      if (!review) {
        const add = node('button', undefined, 'review-slot-add');
        add.type = 'button';
        const plus = node('span', '+', 'review-slot-plus');
        plus.setAttribute('aria-hidden', 'true');
        add.append(plus, node('span', 'Add a review'));
        add.setAttribute('aria-label', 'Add a homepage review to slot ' + (index + 1));
        add.addEventListener('click', () => this.chooseReview());
        slot.classList.add('review-slot-empty');
        slot.append(add);
        return slot;
      }

      const copy = node('div', undefined, 'review-slot-copy');
      const name = node('h3', review.name);
      name.tabIndex = -1;
      if (review.id) name.id = feedbackId(review.id);
      copy.append(name, reviewRating(review.rating), node('blockquote'));
      renderReviewQuote(copy, review.quote, 'review-slot-quote-' + index, 150);
      const remove = this.action(review, 'Remove', 'Unpublished', 'Review removed from the homepage.', 'quiet-button review-slot-remove');
      remove.setAttribute('aria-label', 'Remove ' + review.name + ' from the homepage');
      slot.append(copy, remove);
      return slot;
    });
    this.slots.replaceChildren(...slots);
  }

  action(review, label, publication, message, className = 'quiet-button') {
    const button = node('button', label, className);
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      let saved = false;
      try {
        const target = review.id ? { id: review.id } : { slot: review.slot };
        await this.save({ ...target, revision: review.revision, publication });
        saved = true;
        await this.refresh();
        this.announce(message);
      } catch (error) {
        if (!saved && error.status === 409) await this.refresh().catch(() => {});
        this.announce(saved ? 'Review saved. Refresh the list to see the change.' : error.message, { tone: 'error' });
      } finally {
        button.disabled = false;
        if (!button.isConnected && !this.panel.hidden) {
          if (review.slot !== undefined && saved) this.focusSlot();
          else this.focusFeedback(review.id);
        }
      }
    });
    return button;
  }

  moreActions(review) {
    const menu = node('details', undefined, 'review-more');
    menu.setAttribute('name', 'review-moderation');
    const summary = node('summary', '•••');
    summary.setAttribute('aria-label', 'More actions for ' + review.name);
    const content = node('div', undefined, 'review-more-menu');
    content.append(this.action(review, 'Mark as spam', 'Spam', 'Review marked as spam.'));
    menu.append(summary, content);
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false;
        summary.focus();
      }
    });
    return menu;
  }

  renderList() {
    const query = this.search.value.trim().toLowerCase();
    const reviews = this.groups[this.current];
    const matches = query ? reviews.filter(review =>
      [review.name, review.quote].some(value => String(value ?? '').toLowerCase().includes(query))) : reviews;
    this.list.replaceChildren();
    if (!matches.length) {
      this.list.append(node('li', query ? 'No reviews match your search.' : emptyMessages[this.current], 'reviews-empty'));
      return;
    }
    for (const review of matches) {
      const row = node('li', undefined, 'review-row');
      const content = node('div', undefined, 'review-row-content');
      const header = node('div', undefined, 'review-row-heading');
      const name = node('h2', review.name);
      name.tabIndex = -1;
      if (review.id) name.id = feedbackId(review.id);
      const submitted = node('time', review.submittedAt ? this.date(review.submittedAt) : review.date);
      submitted.dateTime = review.submittedAt || review.date || '';
      header.append(name, reviewRating(review.rating), submitted);
      content.append(header, node('blockquote', review.quote));
      row.append(content);
      if (review.id) {
        const actions = node('div', undefined, 'review-row-actions');
        if (this.current === 'ready' && this.groups.homepage.length < homepageReviewLimit &&
          ratingIsValid(review.rating) && review.quote?.trim()) {
          const add = this.action(review, 'Add to homepage', 'Published', 'Review added to the homepage.', 'button button-outline');
          add.dataset.addReview = '';
          actions.append(add);
        } else if (this.current === 'spam') {
          actions.append(this.action(review, 'Restore review', 'Unpublished', 'Review removed from spam.', 'button button-outline'));
        }
        if (this.current === 'ready' || this.current === 'private') actions.append(this.moreActions(review));
        row.append(actions);
      }
      this.list.append(row);
    }
  }
}
