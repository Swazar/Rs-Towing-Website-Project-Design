export const homepageReviewLimit = 3;

function reviewDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : '';
}

export function renderReviewQuote(card, text, quoteId, previewLength = 220) {
  const quote = card.querySelector('blockquote');
  const characters = Array.from(text);
  if (characters.length <= previewLength) {
    quote.textContent = text;
    return;
  }

  const start = characters.slice(0, previewLength).join('');
  const lastSpace = start.lastIndexOf(' ');
  const excerpt = `${lastSpace > previewLength * .8 ? start.slice(0, lastSpace) : start}…`;
  quote.id = quoteId;
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

export function renderPublishedReviews(entries, { list, template }) {
  const published = entries.filter(entry =>
    typeof entry?.quote === 'string' && entry.quote.trim() &&
    typeof entry.name === 'string' && entry.name.trim() &&
    Number.isInteger(entry.rating) && entry.rating >= 1 && entry.rating <= 5)
    .slice(0, homepageReviewLimit);
  list.replaceChildren();
  list.hidden = published.length === 0;
  for (const [index, entry] of published.entries()) {
    const card = template.content.cloneNode(true);
    const score = card.querySelector('.review-score');
    const stars = document.createElement('span');
    stars.setAttribute('aria-hidden', 'true');
    stars.textContent = '★'.repeat(entry.rating) + '☆'.repeat(5 - entry.rating);
    const ratingText = document.createElement('span');
    ratingText.className = 'sr-only';
    ratingText.textContent = `${entry.rating} out of 5 stars`;
    score.append(stars, ratingText);
    renderReviewQuote(card, entry.quote.trim(), `review-quote-${index}`);
    card.querySelector('.review-author').textContent = entry.name;
    const date = reviewDate(entry.date);
    if (date) {
      const time = card.querySelector('time');
      time.dateTime = date;
      time.textContent = new Date(date).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      });
      time.hidden = false;
    }
    list.append(card);
  }
}
