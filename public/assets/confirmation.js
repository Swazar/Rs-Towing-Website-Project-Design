import { contentReady } from './site-content.js';

contentReady.then(({ localPreview }) => {
  if (!localPreview || !new URLSearchParams(location.search).has('preview')) return;
  const notice = document.createElement('p');
  notice.className = 'local-preview-note field-hint';
  notice.textContent = 'Local preview. This test was saved to the local owner workspace. No notification email was sent.';
  document.querySelector('main').append(notice);
});
