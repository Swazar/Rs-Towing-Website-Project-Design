import { node, icon, emptyState } from './admin-ui.js';
import { calendarEvents, monthDays, dateKey, businessDateKey, locationPoint } from './admin-data.js';
import { formatBusinessTime } from './admin-preferences.js';
import { loadLeaflet, addBasemap } from './route-map.js';

export class OperationsBoard {
  constructor({ openEnquiry, editReminder, toggleReminder, notify, baseLocation, getPreferences }) {
    Object.assign(this, { openEnquiry, editReminder, toggleReminder, notify, baseLocation, getPreferences });
    this.items = []; this.reminders = []; this.today = businessDateKey(); this.selectedDate = this.today;
    const now = new Date(this.today + 'T12:00:00'); this.month = new Date(now.getFullYear(), now.getMonth(), 1);
    this.mapElement = document.querySelector('#overview-job-map');
    this.mapSelect = document.querySelector('#overview-map-request');
    this.routeButton = document.querySelector('#overview-map-route');
    this.mapCaption = document.querySelector('#overview-map-caption');
    this.routeCache = new Map(); this.mapVersion = 0;
    this.mapSelect.addEventListener('change', () => this.updateMap());
    this.routeButton.addEventListener('click', () => this.showRoadRoute());
    document.querySelector('#calendar-previous').addEventListener('click', () => this.changeMonth(-1));
    document.querySelector('#calendar-next').addEventListener('click', () => this.changeMonth(1));
    document.querySelector('#calendar-today').addEventListener('click', () => this.selectDay(businessDateKey()));
    document.querySelector('#calendar-add').addEventListener('click', () => this.editReminder({ date: this.selectedDate }));
  }
  update(items, reminders) {
    this.items = items.filter(item => (item.form_name || item.data['form-name']) === 'quote-request'); this.reminders = reminders;
    this.events = calendarEvents(this.items, reminders); this.renderCalendar();
    // A hidden map has no useful size and should not load tiles or initialize.
    if (this.mapElement.closest('[data-workspace-panel]')?.hidden) { this.mapSignature = undefined; return; }
    const previous = this.mapSelect.value, active = this.items.filter(item => item.state?.status !== 'Closed');
    const signature = JSON.stringify([this.baseLocation(), active.map(item => [item.id, item.data.name, item.data.pickup, item.data.dropoff, item.data.pickup_point, item.data.dropoff_point, item.data.pickup_accuracy, item.data.dropoff_accuracy])]);
    if (signature === this.mapSignature) return;
    this.mapSignature = signature;
    this.mapSelect.replaceChildren(new Option('All open enquiries', ''));
    active.forEach(item => this.mapSelect.add(new Option(item.data.name + ' · ' + (item.data.service || 'Enquiry'), item.id)));
    this.mapSelect.value = active.some(item => item.id === previous) ? previous : active[0]?.id || '';
    this.updateMap();
  }
  changeMonth(amount) {
    this.month = new Date(this.month.getFullYear(), this.month.getMonth() + amount, 1);
    this.selectedDate = dateKey(this.month); this.renderCalendar();
  }
  selectDay(key, focus = false) {
    this.selectedDate = key; const date = new Date(key + 'T12:00:00'); this.month = new Date(date.getFullYear(), date.getMonth(), 1);
    this.renderCalendar(); if (focus) document.querySelector('[data-calendar-date="' + key + '"]')?.focus();
  }
  renderCalendar() {
    this.today = businessDateKey();
    const grid = document.querySelector('#calendar-days'), events = this.events || [];
    document.querySelector('#calendar-month').textContent = this.month.toLocaleDateString([], { month: 'long', year: 'numeric' }); grid.replaceChildren();
    monthDays(this.month.getFullYear(), this.month.getMonth()).forEach(day => {
      const matches = events.filter(event => event.date === day.date), date = new Date(day.date + 'T12:00:00');
      const button = node('button', undefined, 'calendar-day' + (day.inMonth ? '' : ' outside-month')); button.type = 'button'; button.dataset.calendarDate = day.date;
      button.setAttribute('aria-pressed', String(day.date === this.selectedDate)); button.tabIndex = day.date === this.selectedDate ? 0 : -1;
      if (day.date === this.today) button.setAttribute('aria-current', 'date');
      button.setAttribute('aria-label', date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ', ' + matches.length + (matches.length === 1 ? ' item' : ' items'));
      button.append(node('span', String(day.day))); const dots = node('span', undefined, 'calendar-event-dots'); dots.setAttribute('aria-hidden', 'true');
      matches.filter(event => !event.done).slice(0, 3).forEach(event => dots.append(node('i', '', 'event-' + event.kind))); button.append(dots);
      button.addEventListener('click', () => this.selectDay(day.date));
      button.addEventListener('keydown', event => {
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (event.key in offsets) { event.preventDefault(); const next = new Date(date); next.setDate(next.getDate() + offsets[event.key]); this.selectDay(dateKey(next), true); }
        if (event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); this.changeMonth(event.key === 'PageUp' ? -1 : 1); document.querySelector('[data-calendar-date="' + this.selectedDate + '"]')?.focus(); }
      }); grid.append(button);
    });
    document.querySelector('#calendar-selected-date').textContent = new Date(this.selectedDate + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const agenda = document.querySelector('#calendar-agenda'); agenda.replaceChildren();
    const selectedEvents = events.filter(event => event.date === this.selectedDate);
    if (!selectedEvents.length) agenda.append(node('p', 'Nothing scheduled for this day.', 'calendar-empty'));
    selectedEvents.forEach(event => {
      const row = node('div', undefined, 'agenda-row event-' + event.kind + (event.done ? ' is-done' : ''));
      if (event.kind === 'reminder') {
        const input = node('input'); input.type = 'checkbox'; input.checked = event.done; input.setAttribute('aria-label', 'Complete ' + event.title);
        input.addEventListener('change', async () => {
          input.disabled = true;
          try { await this.toggleReminder(this.reminders.find(item => item.id === event.id), input.checked); }
          catch (error) { input.checked = !input.checked; this.notify(error.message); } finally { input.disabled = false; }
        }); row.append(input);
      } else row.append(icon(event.kind === 'pickup' ? 'truck' : event.kind === 'requested' ? 'clock' : 'phone'));
      const button = node('button', undefined, 'agenda-item'); button.type = 'button'; button.append(node('strong', event.title), node('small', event.label + (event.time ? ' · ' + formatBusinessTime(event.time, this.getPreferences?.()) + ' ET' : '')));
      button.addEventListener('click', () => event.kind === 'reminder' ? this.editReminder(this.reminders.find(item => item.id === event.id)) : this.openEnquiry(this.items.find(item => item.id === event.itemId)));
      row.append(button); agenda.append(row);
    });
  }
  async ensureMap() {
    if (this.map) return;
    if (this.mapPromise) return this.mapPromise;
    this.mapPromise = (async () => {
      const [L, places] = await Promise.all([loadLeaflet(), fetch('/assets/us-places.json').then(response => { if (!response.ok) throw new Error('Locations unavailable'); return response.json(); })]);
      this.L = L; this.places = places; this.mapElement.replaceChildren();
      this.basePoint = locationPoint({ data: { pickup: this.baseLocation() } }, 'pickup', places)?.point;
      this.map = L.map(this.mapElement, { scrollWheelZoom: false, zoomControl: true }).setView(this.basePoint || [39, -98], this.basePoint ? 9 : 4);
      addBasemap(this.map);
      this.layers = L.featureGroup().addTo(this.map); this.road = L.layerGroup().addTo(this.map);
      if (typeof ResizeObserver !== 'undefined') {
        this.mapResize = new ResizeObserver(() => { if (this.mapElement.offsetWidth) this.map.invalidateSize({ pan: false }); }); this.mapResize.observe(this.mapElement);
      }
    })().catch(error => { this.mapPromise = undefined; throw error; });
    return this.mapPromise;
  }
  async updateMap() {
    const version = ++this.mapVersion; this.routeButton.disabled = true; this.mapCaption.textContent = 'Loading job locations…';
    try {
      await this.ensureMap(); if (version !== this.mapVersion) return;
      this.basePoint = locationPoint({ data: { pickup: this.baseLocation() } }, 'pickup', this.places)?.point;
      this.layers.clearLayers(); this.road.clearLayers();
      const selected = this.items.find(item => item.id === this.mapSelect.value), items = selected ? [selected] : this.items.filter(item => item.state?.status !== 'Closed');
      let mapped = 0, approximate = 0, missing = 0;
      for (const item of items) for (const name of ['pickup', 'dropoff']) {
        if (!item.data[name] || item.data[name] === 'Unsure') continue;
        const location = locationPoint(item, name, this.places); if (!location) { missing++; continue; }
        mapped++; if (location.approximate) approximate++;
        const popup = node('div', undefined, 'job-map-popup'); popup.append(node('strong', item.data.name || 'Customer'), node('p', (name === 'pickup' ? 'Pickup · ' : 'Drop-off · ') + item.data[name]));
        if (location.approximate) popup.append(node('small', 'Approximate location · confirm the street address'));
        const open = node('button', 'Open enquiry', 'quiet-button'); open.type = 'button'; open.addEventListener('click', () => this.openEnquiry(item)); popup.append(open);
        const color = name === 'pickup' ? '#c31520' : '#1761bf';
        const marker = this.L.marker(location.point, { icon: this.L.divIcon({ className: 'job-location-marker', html: '<span style="--pin-color:' + color + '"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }), title: (name === 'pickup' ? 'Pickup' : 'Drop-off') + ': ' + item.data[name], alt: (name === 'pickup' ? 'Pickup' : 'Drop-off') + ' for ' + item.data.name });
        marker.bindPopup(popup).addTo(this.layers);
      }
      this.map.invalidateSize({ pan: false });
      if (mapped) this.map.fitBounds(this.layers.getBounds(), { padding: [35, 35], maxZoom: 11, animate: false });
      else this.map.setView(this.basePoint || [39, -98], this.basePoint ? 9 : 4, { animate: false });
      this.mapCaption.textContent = mapped ? mapped + (mapped === 1 ? ' location shown.' : ' locations shown.') + (approximate ? ' Some pins show approximate city or street locations.' : '') + (missing ? ' ' + missing + ' location(s) need confirmation.' : '') : items.length ? 'These locations need confirmation. Open the enquiry to see the entered addresses.' : 'No open mapped enquiries. New job locations will appear here.';
      this.routeButton.disabled = !selected || !locationPoint(selected, 'pickup', this.places) || !locationPoint(selected, 'dropoff', this.places);
    } catch {
      this.mapElement.replaceChildren(emptyState('Map unavailable', 'You can still open enquiries and use driving directions.', 'map-pin'));
      const retry = node('button', 'Retry map', 'quiet-button'); retry.type = 'button'; retry.addEventListener('click', () => this.updateMap()); this.mapElement.append(retry);
      this.mapCaption.textContent = 'The map could not load. Your enquiry data is still available.';
    }
  }
  async showRoadRoute() {
    const item = this.items.find(entry => entry.id === this.mapSelect.value); if (!item || !this.map) return;
    const pickup = locationPoint(item, 'pickup', this.places), dropoff = locationPoint(item, 'dropoff', this.places); if (!pickup || !dropoff) return;
    const version = this.mapVersion, key = pickup.point.join(',') + '|' + dropoff.point.join(',');
    this.routeButton.disabled = true; this.mapCaption.textContent = 'Finding the driving route…';
    try {
      let route = this.routeCache.get(key);
      if (!route) {
        const response = await fetch('/.netlify/functions/route-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pickup: pickup.point.join(','), dropoff: dropoff.point.join(',') }) });
        if (!response.ok) throw new Error('Route unavailable'); route = await response.json(); this.routeCache.set(key, route);
      }
      if (version !== this.mapVersion) return;
      this.road.clearLayers(); const line = this.L.polyline(route.path, { color: '#1761bf', weight: 5 }).addTo(this.road);
      this.map.fitBounds(line.getBounds(), { padding: [25, 25], animate: false });
      this.mapCaption.textContent = route.miles.toLocaleString('en-US') + ' driving miles · about ' + route.minutes + ' min' + (pickup.approximate || dropoff.approximate ? ' · Approximate endpoints; confirm the street addresses.' : '');
    } catch { if (version === this.mapVersion) this.mapCaption.textContent = 'Driving route unavailable. The location pins are still shown; use driving directions in the enquiry.'; }
    finally { if (version === this.mapVersion) this.routeButton.disabled = false; }
  }
}

export async function prepareAvatar(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP image up to 5 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, 256, 256);
    const side = Math.min(bitmap.width, bitmap.height); context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    const result = canvas.toDataURL('image/jpeg', .82); if (result.length > 105000) throw new Error('Choose a simpler or smaller profile photo.'); return result;
  } finally { bitmap.close(); }
}
