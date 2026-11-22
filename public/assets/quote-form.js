import { addRoutePreview } from './route-map.js';
import { addLocationSuggestions } from './us-locations.js';
import { usStates } from './business-defaults.js';
import { sendForm } from './form-request.js';

const draftKey = 'rs-quote-draft-v1';
const draftLifetime = 2 * 60 * 60 * 1000;

export function enhanceQuoteForm() {
  const dialog = document.querySelector('#quote-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const form = document.forms['quote-request'];
  const entry = dialog.querySelector('.quote-entry');
  const success = dialog.querySelector('.quote-success');
  const successTitle = success.querySelector('#quote-success-title');
  const successCopy = success.querySelector('#quote-success-copy');
  const successPreview = success.querySelector('#quote-success-preview');
  const steps = [...form.querySelectorAll('.quote-step')];
  const progress = [...dialog.querySelectorAll('.quote-progress li')];
  const progressLabel = dialog.querySelector('.quote-progress-label');
  const back = form.querySelector('.quote-back');
  const next = form.querySelector('.quote-next');
  const service = form.elements.service;
  const locations = addLocationSuggestions(form);
  const summary = form.querySelector('#quote-summary-details');
  const status = form.querySelector('.submit-status');
  const modeButton = form.querySelector('.route-mode-toggle');
  const automaticFields = form.querySelector('#automatic-locations');
  let manualMode = false;
  let automaticCache = { pickup: '', dropoff: '', selected: {} };
  let activeStep = 0;
  let editingSummary = false;
  let opener;
  let sending = false;
  let previousDropoff = '';
  let previousDropoffPlace;
  let wasUndecided = false;
  let requestId = crypto.randomUUID();

  for (const select of form.querySelectorAll('[data-us-state]')) {
    select.add(new Option('Choose a state', ''));
    usStates.forEach(([code, name]) => select.add(new Option(name, code)));
  }

  function setError(field, message) {
    let error = document.getElementById(field.id + '-error');
    if (message && !error) {
      error = document.createElement('p');
      error.className = 'field-error';
      error.id = field.id + '-error';
      field.closest('.field').append(error);
      field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
    }
    if (error) { error.textContent = message; error.hidden = !message; }
    if (message) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  }

  function syncManual(name) {
    const panel = document.querySelector('#' + name + '-manual');
    const enabled = manualMode && !(name === 'dropoff' && form.elements.dropoff_undecided.checked);
    panel.hidden = !enabled;
    panel.querySelectorAll('input, select').forEach(field => {
      field.disabled = !enabled;
      field.required = enabled && !field.name.endsWith('_zip');
    });
    const field = form.elements[name];
    locations.setManual(field, enabled);
    field.readOnly = enabled || (name === 'dropoff' && form.elements.dropoff_undecided.checked);
    field.required = !manualMode && !(name === 'dropoff' && form.elements.dropoff_undecided.checked);
    field.maxLength = manualMode ? 350 : 120;
    if (enabled) {
      const parts = ['street', 'city', 'state', 'zip'].map(part => form.elements[name + '_' + part].value.trim());
      field.value = parts.filter(Boolean).join(', ');
    } else if (name === 'dropoff' && form.elements.dropoff_undecided.checked) field.value = 'Unsure';
    form.elements[name + '_accuracy'].value = enabled ? 'Manual location — owner confirmation needed'
      : name === 'dropoff' && form.elements.dropoff_undecided.checked ? 'Not decided'
        : locations.isStreetOnly(field) ? 'Street only' : locations.pointFor(field) ? 'Matched location' : 'Not matched';
    form.elements[name + '_point'].value = field.value === 'Unsure' ? '' : locations.pointFor(field)?.join(',') || '';
  }

  function updateConditionalFields() {
    const undecided = form.elements.dropoff_undecided.checked;
    if (undecided !== wasUndecided) {
      if (undecided) {
        previousDropoff = form.elements.dropoff.value;
        previousDropoffPlace = locations.snapshot().dropoff;
      } else if (!manualMode) {
        form.elements.dropoff.value = previousDropoff;
        locations.restore({ ...locations.snapshot(), dropoff: previousDropoffPlace });
      }
      wasUndecided = undecided;
    }
    const groupName = { 'Vehicle towing or transport': 'vehicle', 'Urgent or same-day pickup': 'vehicle',
      'Equipment hauling': 'freight', 'Freight or cargo transport': 'freight' }[service.value];
    for (const group of form.querySelectorAll('[data-load-fields]')) {
      group.hidden = group.dataset.loadFields !== groupName;
      group.querySelectorAll('input, select').forEach(field => { field.disabled = group.hidden; });
    }
    const specific = form.elements.pickup_timing.value === 'Specific date';
    form.querySelector('#pickup-date-field').hidden = !specific;
    form.elements.pickup_date.disabled = !specific;
    form.elements.pickup_date.required = specific;
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    form.elements.pickup_date.min = localDate;
    form.querySelector('#today-hint').hidden = form.elements.pickup_timing.value !== 'Today';
    automaticFields.hidden = manualMode;
    modeButton.setAttribute('aria-expanded', String(manualMode));
    modeButton.textContent = manualMode ? 'Use address suggestions' : 'Enter locations manually';
    form.querySelector('#dropoff-hint').hidden = manualMode;
    for (const name of ['pickup', 'dropoff']) syncManual(name);
  }

  function renderSummary() {
    const timing = form.elements.pickup_timing.value === 'Specific date' ? form.elements.pickup_date.value : form.elements.pickup_timing.value;
    const rows = [
      ['Pickup', form.elements.pickup.value, 0],
      ['Drop-off', form.elements.dropoff.value === 'Unsure' ? 'Not decided' : form.elements.dropoff.value, 0],
      ['Service', service.value, 1], ['Timing', timing, 1],
      ['Load', form.elements.details.value, 1],
    ];
    summary.replaceChildren(...rows.map(([label, value, step]) => {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      const button = document.createElement('button');
      term.textContent = label;
      detail.textContent = value || 'Not provided';
      button.type = 'button'; button.className = 'summary-change';
      button.textContent = 'Change'; button.setAttribute('aria-label', 'Change ' + label.toLowerCase());
      button.addEventListener('click', () => { editingSummary = true; showStep(step); steps[step].querySelector('legend').focus(); });
      row.append(term, detail, button);
      return row;
    }));
  }

  function showStep(index) {
    activeStep = Math.max(0, Math.min(2, index));
    steps.forEach((step, i) => { step.hidden = i !== activeStep; });
    progress.forEach((item, i) => {
      item.classList.toggle('is-complete', i < activeStep);
      if (i === activeStep) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    progressLabel.textContent = `Step ${activeStep + 1} of 3 · ${progress[activeStep].textContent}`;
    back.hidden = activeStep === 0;
    next.textContent = activeStep === 2 ? 'Send quote request' : editingSummary ? 'Save changes' : 'Continue';
    if (activeStep === 2) renderSummary();
    dialog.scrollTop = 0;
    saveDraft();
  }

  function validateStep(step) {
    let first;
    step.querySelectorAll('input, select, textarea').forEach(field => {
      if (field.disabled || field.type === 'hidden' || field.type === 'checkbox') return;
      const missing = field.required && !field.value.trim();
      const message = missing ? field.dataset.requiredMessage || 'Enter ' + field.labels?.[0]?.textContent.toLowerCase() + '.'
        : locations.errorFor(field) || field.validationMessage;
      setError(field, message);
      if (message) first ??= field;
    });
    return first;
  }

  function saveDraft() {
    if (sending) return;
    const values = Object.fromEntries([...form.elements].filter(field => field.name && !['form-name', 'bot-field'].includes(field.name))
      .map(field => [field.name, field.type === 'checkbox' ? field.checked : field.value]));
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ version: 1, savedAt: Date.now(), values, manualMode, automaticCache, previousDropoff, previousDropoffPlace, selected: locations.snapshot(), activeStep, requestId }));
    } catch { /* Form entry still works when browser storage is unavailable. */ }
  }

  async function restoreDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey));
      if (!draft || draft.version !== 1 || Date.now() - draft.savedAt > draftLifetime) return;
      for (const [name, value] of Object.entries(draft.values)) {
        const field = form.elements[name];
        if (!field || field.type === 'hidden') continue;
        if (field.type === 'checkbox') field.checked = value === true;
        else if (typeof value === 'string') field.value = value;
      }
      manualMode = draft.manualMode === true || draft.manual?.pickup === true || draft.manual?.dropoff === true;
      if (draft.automaticCache && typeof draft.automaticCache.pickup === 'string' && typeof draft.automaticCache.dropoff === 'string') {
        automaticCache = draft.automaticCache;
      } else {
        automaticCache = { pickup: draft.manual?.pickup ? '' : draft.values.pickup || '',
          dropoff: draft.manual?.dropoff ? '' : draft.values.dropoff || '', selected: draft.selected };
      }
      previousDropoff = typeof draft.previousDropoff === 'string' ? draft.previousDropoff : '';
      previousDropoffPlace = draft.previousDropoffPlace;
      wasUndecided = form.elements.dropoff_undecided.checked;
      if (/^[a-f0-9-]{36}$/.test(draft.requestId)) requestId = draft.requestId;
      await locations.prepare();
      locations.restore(draft.selected);
      updateConditionalFields();
      showStep(Number.isInteger(draft.activeStep) ? draft.activeStep : 0);
    } catch { /* Ignore an expired or invalid draft. */ }
  }

  modeButton.addEventListener('click', () => {
    if (!manualMode) {
      automaticCache = { pickup: form.elements.pickup.value, dropoff: form.elements.dropoff.value, selected: locations.snapshot() };
      if (form.elements.dropoff_undecided.checked) {
        automaticCache.dropoff = previousDropoff;
        automaticCache.selected.dropoff = previousDropoffPlace;
      }
    }
    manualMode = !manualMode;
    if (!manualMode) {
      form.elements.pickup.value = automaticCache.pickup;
      form.elements.dropoff.value = automaticCache.dropoff;
      locations.restore(automaticCache.selected);
      if (form.elements.dropoff_undecided.checked) {
        previousDropoff = automaticCache.dropoff;
        previousDropoffPlace = automaticCache.selected?.dropoff;
      }
    }
    steps[0].querySelectorAll('[aria-invalid]').forEach(field => setError(field, ''));
    updateConditionalFields();
    const region = form.querySelector('.location-mode-content');
    if (window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches && region.animate) {
      region.animate([{ opacity: .25, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
    }
    form.elements.pickup.dispatchEvent(new Event('routechange'));
    saveDraft();
  });
  form.addEventListener('input', ({ target }) => {
    if (target.type === 'hidden') return;
    updateConditionalFields();
    if (target.hasAttribute('aria-invalid')) setError(target, '');
    form.elements.pickup.dispatchEvent(new Event('routechange'));
    saveDraft();
  });
  form.addEventListener('change', () => {
    updateConditionalFields();
    form.elements.pickup.dispatchEvent(new Event('routechange'));
    saveDraft();
  });
  back.addEventListener('click', () => {
    editingSummary = false; showStep(activeStep - 1); steps[activeStep].querySelector('legend').focus();
  });
  function resetForm() {
    form.reset(); manualMode = false; automaticCache = { pickup: '', dropoff: '', selected: {} }; editingSummary = false;
    previousDropoff = ''; previousDropoffPlace = undefined; wasUndecided = false;
    requestId = crypto.randomUUID();
    locations.restore({});
    form.querySelectorAll('[aria-invalid]').forEach(field => setError(field, ''));
    status.hidden = true; updateConditionalFields(); showStep(0);
    form.elements.pickup.dispatchEvent(new Event('routechange'));
  }
  form.querySelector('.quote-reset').addEventListener('click', () => {
    if (sending) return;
    resetForm();
    steps[0].querySelector('legend').focus();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    for (let i = 0; i <= activeStep; i++) {
      const invalid = validateStep(steps[i]);
      if (invalid) { showStep(i); invalid.focus(); return; }
    }
    if (activeStep < 2) {
      const step = editingSummary ? 2 : activeStep + 1;
      editingSummary = false; showStep(step); steps[step].querySelector('legend').focus(); return;
    }
    sending = true; next.disabled = true; next.textContent = 'Sending…'; status.hidden = true;
    form.elements.request_id.value = requestId;
    let local;
    try {
      local = await sendForm(form);
    } catch (error) {
      status.textContent = error.message; status.hidden = false;
      sending = false; next.disabled = false; next.textContent = 'Try sending again';
      return;
    }
    resetForm();
    try { sessionStorage.removeItem(draftKey); } catch {}
    sending = false;
    next.disabled = false;
    entry.hidden = true;
    successCopy.hidden = local;
    successPreview.hidden = !local;
    success.hidden = false;
    dialog.setAttribute('aria-labelledby', successTitle.id);
    dialog.setAttribute('aria-describedby', local ? successPreview.id : successCopy.id);
    dialog.scrollTop = 0;
    if (dialog.open) successTitle.focus();
  });
  entry.append(form);
  form.noValidate = true;
  updateConditionalFields();
  steps.forEach((step, i) => { step.hidden = i !== 0; });
  const restored = restoreDraft().then(() => showStep(activeStep));
  addRoutePreview(form, locations, () => validateStep(steps[0]));
  for (const trigger of document.querySelectorAll('[data-quote]')) {
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.addEventListener('click', async event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      await restored;
      if (dialog.open) return;
      opener = trigger;
      success.hidden = true;
      entry.hidden = false;
      dialog.setAttribute('aria-labelledby', 'quote-dialog-title');
      dialog.removeAttribute('aria-describedby');
      if (trigger.dataset.service) {
        service.value = trigger.dataset.service; updateConditionalFields(); showStep(0);
      }
      dialog.showModal(); locations.prepare();
    });
  }
  dialog.querySelector('.quote-close').addEventListener('click', () => dialog.close());
  success.querySelector('.quote-done').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (success.hidden) saveDraft();
    opener?.focus({ preventScroll: true });
  });
}
