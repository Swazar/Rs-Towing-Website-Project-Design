import { sendForm } from './form-request.js';
import { contentReady } from './site-content.js';

export function enableReviewCounter(form) {
  const field = form.elements.review;
  const counter = form.querySelector('#review-count');
  function updateCount() {
    counter.textContent = `${field.value.length} / ${field.maxLength} characters`;
  }
  field.addEventListener('input', updateCount);
  updateCount();
  contentReady.then(({ localPreview }) => { form.querySelector('.local-preview-note').hidden = !localPreview; });
  const status = form.querySelector('.submit-status');
  const button = form.querySelector('[type="submit"]');
  let sending = false;
  form.elements.request_id.value = crypto.randomUUID();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    sending = true; button.disabled = true; button.textContent = 'Sending…'; status.hidden = true;
    try {
      const local = await sendForm(form);
      location.assign('/review-sent/' + (local ? '?preview=1' : ''));
    } catch (error) {
      status.textContent = error.message; status.hidden = false;
      sending = false; button.disabled = false; button.textContent = 'Try sending again';
    }
  });
}

const reviewForm = document.forms['customer-review'];
if (reviewForm) enableReviewCounter(reviewForm);
