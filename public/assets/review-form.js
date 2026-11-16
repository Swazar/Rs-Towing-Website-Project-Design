export function enableReviewCounter(form) {
  const field = form.elements.review;
  const counter = form.querySelector('#review-count');
  function updateCount() {
    counter.textContent = `${field.value.length} / ${field.maxLength} characters`;
  }
  field.addEventListener('input', updateCount);
  updateCount();
}

const reviewForm = document.forms['customer-review'];
if (reviewForm) enableReviewCounter(reviewForm);
