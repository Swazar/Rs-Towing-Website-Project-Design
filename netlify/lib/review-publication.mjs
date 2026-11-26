import { publicReview } from './validation.mjs';
import { homepageReviewLimit } from '../../public/assets/public-reviews.js';

function isCustomerReview(item) {
  return (item.form_name || item.data['form-name']) === 'customer-review';
}

export function publicHomepageReviews(publication) {
  return publication?.reviews?.slice(0, homepageReviewLimit) ?? null;
}

export function reviewHomepage(publication, items, revision) {
  const reviews = publicHomepageReviews(publication) ?? [];
  const ids = publication?.reviewIds;
  if (!reviews.length) return [];

  // Older snapshots stored the public fields only. Match existing reviews to
  // their original submissions until the next moderation save adds IDs.
  const key = review => JSON.stringify([review.name, review.rating, review.date, review.quote]);
  const legacyIds = new Map();
  if (!ids) {
    for (const item of items) {
      if (!isCustomerReview(item)) continue;
      const review = publicReview(item, publication.decisions?.[item.id]);
      if (!review) continue;
      const signature = key(review);
      if (!legacyIds.has(signature)) legacyIds.set(signature, []);
      legacyIds.get(signature).push(item.id);
    }
  }
  return reviews.map((review, index) => ({
    ...review,
    id: ids?.[index] ?? legacyIds.get(key(review))?.shift(),
    revision: revision ?? null,
  }));
}

function reviewError(message, status) {
  return Object.assign(new Error(message), { status });
}

export function changeReviewPublication(previous, items, body, updatedBy) {
  const { id, slot, publication } = body;
  const validId = typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
  const removeBySlot = id == null && publication === 'Unpublished' &&
    Number.isInteger(slot) && slot >= 0 && slot < homepageReviewLimit;
  if (!['Published', 'Unpublished', 'Spam'].includes(publication) || !(validId || removeBySlot)) {
    throw reviewError('Choose a review action.', 400);
  }

  // Only the stored homepage list selects what visitors see. Old publication
  // decisions remain available for audit and never refill a vacated slot.
  const selected = reviewHomepage(previous, items);
  const listed = removeBySlot ? selected[slot] : selected.find(review => review.id === id);
  const reviewId = listed?.id ?? id;
  const submission = items.find(item => item.id === reviewId && isCustomerReview(item));
  if (!submission && !(listed && publication === 'Unpublished')) {
    throw reviewError('Review not found.', 404);
  }

  let reviews = selected.filter(review => review !== listed);
  if (publication === 'Published') {
    if (submission.data['publish-permission'] !== 'yes') {
      throw reviewError('This customer did not give permission to publish.', 400);
    }
    const review = publicReview(submission, { publication });
    if (!review) throw reviewError('This review is missing a valid rating or comment.', 400);
    if (!listed && selected.length >= homepageReviewLimit) {
      throw reviewError('All homepage slots are filled. Remove a review before adding another.', 409);
    }
    reviews = listed ? selected : [...selected, { ...review, id: reviewId }];
  }

  const decision = { publication, updatedBy, updatedAt: new Date().toISOString() };
  const decisions = { ...previous?.decisions, ...(reviewId && { [reviewId]: decision }) };
  return {
    snapshot: {
      decisions,
      reviews: reviews.map(({ name, quote, rating, date }) => ({ name, quote, rating, date })),
      reviewIds: reviews.map(review => review.id ?? null),
    },
    name: submission?.data.first_name || listed?.name || 'Customer',
  };
}
