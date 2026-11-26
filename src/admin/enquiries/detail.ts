import { node, icon, initials, picture, statusLabel } from '../../../public/assets/admin-ui.js';
import { contactLinks, priceInput, priceLabel } from '../../../public/assets/enquiry-contact.js';
import { drivingDirectionsUrl, renderRoadRoute } from '../../../public/assets/route-map.js';
import { describeJobNumber, enquiryHash } from '../../domain/jobs/job-number.ts';
import { enquiryStatuses, type Enquiry, type EnquiryDraft } from '../../domain/jobs/types.ts';
import { formField as field } from '../components/form-field.ts';

export interface Draft {
  fields: EnquiryDraft;
  revision: string | null | undefined;
}

interface DetailOptions {
  date: (value: string) => string;
  time: (value: string) => string;
  draft?: Draft;
  onDraft: (fields: EnquiryDraft) => void;
  onDiscard: () => void;
  onSave: (fields: EnquiryDraft, revision: Draft['revision']) => Promise<void>;
  onHistory?: () => Promise<void>;
  onError: (error: unknown) => void;
}

export function addDetail(list: HTMLElement, label: string, value?: string) {
  if (!value) return;
  const row = node('div');
  row.append(node('dt', label), node('dd', value));
  list.append(row);
}

function fact(container: HTMLElement, label: string, value: string | undefined, iconName: string) {
  if (!value) return;
  const box = node('div', undefined, 'record-fact');
  const caption = node('small');
  caption.append(icon(iconName), node('span', label));
  box.append(caption, node('strong', value));
  container.append(box);
}

function createTabs() {
  const tablist = node('div', undefined, 'record-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Enquiry details');
  const labels = ['Route & load', 'Customer', 'Notes & status'];
  const buttons = labels.map(name => node('button', name));
  const panels = labels.map(() => node('div', undefined, 'record-tab-panel'));

  function selectTab(index: number, focus = false) {
    buttons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(index === i));
      button.tabIndex = index === i ? 0 : -1;
      panels[i].hidden = index !== i;
    });
    if (focus) buttons[index].focus();
  }

  buttons.forEach((button, index) => {
    const panel = panels[index];
    button.type = 'button';
    button.id = 'enquiry-tab-' + index;
    button.setAttribute('role', 'tab');
    panel.id = 'enquiry-panel-' + index;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    button.setAttribute('aria-controls', panel.id);
    tablist.append(button);
    button.addEventListener('click', () => selectTab(index));
    button.addEventListener('keydown', event => {
      const indexes: Record<string, number> = {
        ArrowRight: (index + 1) % buttons.length,
        ArrowLeft: (index + buttons.length - 1) % buttons.length,
        Home: 0,
        End: buttons.length - 1,
      };
      if (!Object.hasOwn(indexes, event.key)) return;
      event.preventDefault();
      selectTab(indexes[event.key], true);
    });
  });
  selectTab(0);
  return { tablist, panels, selectTab };
}

function addRouteTools(panel: HTMLElement, item: Enquiry): () => void {
  const { pickup, dropoff, pickup_point, dropoff_point } = item.data;
  let dispose: (() => void) | undefined;
  let controller: AbortController | undefined;
  const cleanup = () => { controller?.abort(); dispose?.(); };
  if (!pickup || !dropoff || dropoff === 'Unsure') return cleanup;
  const tools = node('div', undefined, 'owner-route-actions');
  const link = node('a', 'Open driving directions');
  link.href = drivingDirectionsUrl(pickup, dropoff);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  tools.append(link);
  panel.append(tools);

  function point(value?: string): [number, number] | null {
    const parts = (value || '').split(',').map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) && Math.abs(parts[0]) <= 90 && Math.abs(parts[1]) <= 180
      ? [parts[0], parts[1]] : null;
  }
  const from = point(pickup_point), to = point(dropoff_point);
  if (!from || !to) return cleanup;
  const button = node('button', undefined, 'button button-outline');
  button.type = 'button';
  button.append(icon('map-pin'), node('span', 'Preview route'));
  tools.prepend(button);
  const map = node('div', undefined, 'route-map owner-route-map');
  const info = node('p', '', 'field-hint');
  info.setAttribute('role', 'status');
  map.hidden = true;
  panel.append(info, map);

  button.addEventListener('click', async () => {
    button.disabled = true;
    controller = new AbortController();
    info.textContent = 'Looking up the driving route…';
    try {
      const response = await fetch('/.netlify/functions/route-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickup: pickup_point, dropoff: dropoff_point }), signal: controller.signal,
      });
      if (!response.ok) throw new Error('Route unavailable');
      const route = await response.json();
      if (controller.signal.aborted) return;
      map.hidden = false;
      dispose?.();
      const result = await renderRoadRoute(map, route, { pickup: from, dropoff: to });
      if (controller.signal.aborted || !map.isConnected) { result(); return; }
      dispose = result;
      info.textContent = route.miles.toLocaleString('en-US') + ' driving miles · about ' + route.minutes + ' min';
    } catch {
      if (!controller.signal.aborted) info.textContent = 'Route preview unavailable. You can open driving directions.';
    } finally { button.disabled = false; }
  });
  return cleanup;
}

function renderRoute(panel: HTMLElement, item: Enquiry, time: DetailOptions['time']) {
  const { data, state } = item;
  const route = node('div', undefined, 'route-locations');
  for (const [label, value] of [['PICKUP', data.pickup], ['DROP-OFF', data.dropoff === 'Unsure' ? 'Not decided yet' : data.dropoff]]) {
    const stop = node('div', undefined, 'route-stop'), copy = node('div');
    copy.append(node('small', label), node('strong', value));
    stop.append(icon('map-pin'), copy);
    route.append(stop);
  }
  panel.append(route);
  const dispose = addRouteTools(panel, item);
  const visual = node('div', undefined, 'load-visual'), copy = node('div');
  const service = data.service || '';
  const image = /equipment/i.test(service) ? '/assets/equipment-transport.webp'
    : /freight/i.test(service) ? '/assets/flatbed-freight.webp' : '/assets/hauling-hero.webp';
  copy.append(node('strong', service), node('small', 'Service reference image'));
  visual.append(picture(image, ''), copy);
  panel.append(visual);
  const facts = node('div', undefined, 'record-facts');
  fact(facts, 'Preferred timing', [data.pickup_timing, data.pickup_date].filter(Boolean).join(' · '), 'calendar-days');
  fact(facts, 'Confirmed pickup', [state?.scheduledDate, state?.scheduledTime && time(state.scheduledTime) + ' ET'].filter(Boolean).join(' · '), 'calendar-days');
  fact(facts, 'Agreed price', priceLabel(state?.priceCents), 'clipboard-list');
  fact(facts, 'Vehicle runs', data.vehicle_runs, 'truck');
  fact(facts, 'Weight', data.load_weight ? data.load_weight + ' lb' : '', 'truck');
  fact(facts, 'Dimensions', data.load_dimensions, 'clipboard-list');
  panel.append(facts, node('p', data.details, 'record-description'));
  if (data.pickup_accuracy || data.dropoff_accuracy) {
    const extra = node('details', undefined, 'record-disclosure');
    const list = node('dl');
    addDetail(list, 'Pickup', data.pickup_accuracy);
    addDetail(list, 'Drop-off', data.dropoff_accuracy);
    extra.append(node('summary', 'Location accuracy notes'), list);
    panel.append(extra);
  }
  return dispose;
}

function renderEditor(panel: HTMLElement, item: Enquiry, options: DetailOptions) {
  const { state } = item;
  const fields = options.draft?.fields ?? { ...state, agreedPrice: priceInput(state?.priceCents) };
  const form = node('form');
  const editor = node('fieldset', undefined, 'enquiry-edit-fields');
  const statusField = node('div', undefined, 'field'), label = node('label', 'Status');
  const status = node('select');
  label.htmlFor = status.id = 'enquiry-status';
  for (const value of enquiryStatuses) status.add(new Option(value, value));
  status.value = fields.status || 'New';
  statusField.append(label, status);
  const note = field('Private note', 'note', fields.note, 'textarea', 2000);
  const followUp = field('Follow-up date (optional)', 'followUp', fields.followUp, 'date');
  const pickupDate = field('Confirmed pickup date (optional)', 'scheduledDate', fields.scheduledDate, 'date');
  const pickupTime = field('Pickup time · Eastern (optional)', 'scheduledTime', fields.scheduledTime, 'time');
  const price = field('Agreed price (USD, optional)', 'agreedPrice', fields.agreedPrice, 'text', 10);
  const priceInputField = price.input as HTMLInputElement;
  priceInputField.inputMode = 'decimal';
  priceInputField.pattern = '[0-9]{1,7}(\\.[0-9]{1,2})?';
  priceInputField.placeholder = '0.00';
  const schedule = node('div', undefined, 'form-grid'), followUpFields = node('div', undefined, 'form-grid');
  schedule.append(pickupDate.wrapper, pickupTime.wrapper);
  followUpFields.append(price.wrapper, followUp.wrapper);
  const save = node('button', 'Save enquiry', 'button'), discard = node('button', 'Discard edits', 'quiet-button enquiry-history');
  save.type = 'submit';
  discard.type = 'button';
  discard.hidden = !options.draft;
  discard.addEventListener('click', options.onDiscard);
  editor.append(statusField, schedule, node('p', 'Set a confirmed date after agreeing it with the customer. Requested dates stay separate.', 'field-hint'), followUpFields, note.wrapper, save, discard);
  if (options.onHistory) {
    const history = node('button', 'Version history', 'quiet-button enquiry-history');
    history.type = 'button';
    history.addEventListener('click', async () => {
      history.disabled = true;
      try { await options.onHistory?.(); }
      catch (error) { options.onError(error); }
      finally { history.disabled = false; }
    });
    editor.append(history);
  }
  if (state?.updatedAt) editor.append(node('p', 'Last saved ' + options.date(state.updatedAt), 'field-hint'));
  form.append(editor);
  panel.append(node('p', 'Notes and prices are visible to authorized admins.', 'field-hint'), form);

  const values = (): EnquiryDraft => ({
    status: status.value, note: note.input.value, followUp: followUp.input.value,
    scheduledDate: pickupDate.input.value, scheduledTime: pickupTime.input.value, agreedPrice: price.input.value,
  });
  form.addEventListener('input', () => { options.onDraft(values()); discard.hidden = false; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (editor.disabled) return;
    editor.disabled = true;
    try { await options.onSave(values(), options.draft ? options.draft.revision : item.revision); }
    catch (error) { options.onError(error); }
    finally { editor.disabled = false; }
  });
}

function addJobNumber(parent: HTMLElement, number: string) {
  const line = node('div', undefined, 'enquiry-reference');
  const value = node('strong', number);
  const state = node('span', '', 'sr-only');
  state.setAttribute('role', 'status');
  const manual = node('input', undefined, 'enquiry-copy-fallback');
  manual.readOnly = true;
  manual.hidden = true;
  const link = new URL(window.location.pathname + enquiryHash(number), window.location.origin).href;
  line.append(value);
  for (const [label, text] of [['Copy job number', number], ['Copy job link', link]]) {
    const button = node('button', label, 'quiet-button');
    button.type = 'button';
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        manual.hidden = true;
        state.textContent = label === 'Copy job link' ? 'Private job link copied.' : 'Copied ' + number;
      } catch {
        manual.value = text;
        manual.setAttribute('aria-label', label === 'Copy job link' ? 'Private job link' : 'Job number');
        manual.hidden = false;
        manual.focus();
        manual.select();
        state.textContent = 'Copy the selected text.';
      }
    });
    line.append(button);
  }
  line.append(state);
  parent.append(line, manual, node('p', describeJobNumber(number), 'enquiry-reference-description'));
}

export function createEnquiryDetail(item: Enquiry, options: DetailOptions) {
  const record = node('article', undefined, 'owner-record');
  const heading = node('div', undefined, 'record-heading'), title = node('div');
  title.append(node('h3', item.data.name || 'Customer'), node('p', 'Received ' + options.date(item.created_at)));
  heading.append(node('span', initials(item.data.name), 'initials'), title, statusLabel(item.state?.status));
  record.append(heading);
  if (item.jobNumber) addJobNumber(record, item.jobNumber);
  const actions = node('div', undefined, 'owner-contact-actions enquiry-contact');
  const links = contactLinks(item.data);
  for (const [label, href, name] of [['Call customer', links.call, 'phone'], ['Text customer', links.sms, 'message-square'], ['Email customer', links.mail, 'mail']]) {
    if (!href) continue;
    const link = node('a', undefined, 'button button-outline');
    link.href = href;
    link.append(icon(name), node('span', label));
    actions.append(link);
  }
  if (actions.childElementCount) record.append(actions);
  const { tablist, panels, selectTab } = createTabs();
  record.append(tablist, ...panels);
  const dispose = renderRoute(panels[0], item, options.time);
  const customer = node('dl');
  addDetail(customer, 'Name', item.data.name);
  addDetail(customer, 'Phone', item.data.phone);
  addDetail(customer, 'Email', item.data.email || 'Not provided');
  panels[1].append(customer);
  renderEditor(panels[2], item, options);
  return { element: record, dispose, showEditor: (focus = false) => selectTab(2, focus) };
}
