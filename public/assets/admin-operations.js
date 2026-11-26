import { node, icon } from './admin-ui.js';
import { calendarEvents, monthDays, dateKey, businessDateKey } from './admin-data.js';
import { formatBusinessTime } from './admin-preferences.js';
import { JobMap } from './admin-job-map.js';

export class OperationsBoard {
  constructor({ openEnquiry, editReminder, toggleReminder, notify, getPreferences }) {
    Object.assign(this, { openEnquiry, editReminder, toggleReminder, notify, getPreferences });
    this.items = []; this.reminders = []; this.today = businessDateKey(); this.selectedDate = this.today;
    const now = new Date(this.today + 'T12:00:00'); this.month = new Date(now.getFullYear(), now.getMonth(), 1);
    this.map = new JobMap(document.querySelector('.jobs-map-panel'), openEnquiry);
    document.querySelector('#calendar-previous').addEventListener('click', () => this.changeMonth(-1));
    document.querySelector('#calendar-next').addEventListener('click', () => this.changeMonth(1));
    document.querySelector('#calendar-today').addEventListener('click', () => this.selectDay(businessDateKey()));
    document.querySelector('#calendar-add').addEventListener('click', () => this.editReminder({ date: this.selectedDate }));
  }
  update(items, reminders) {
    this.items = items.filter(item => (item.form_name || item.data['form-name']) === 'quote-request'); this.reminders = reminders;
    this.events = calendarEvents(this.items, reminders); this.renderCalendar();
    this.map.update(this.items);
  }
  setMapActive(active) { this.map.setActive(active); }
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
}

export async function prepareAvatar(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP image up to 5 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, 256, 256);
    const scale = 256 / Math.max(bitmap.width, bitmap.height);
    const width = bitmap.width * scale, height = bitmap.height * scale;
    context.drawImage(bitmap, (256 - width) / 2, (256 - height) / 2, width, height);
    const result = canvas.toDataURL('image/jpeg', .82); if (result.length > 105000) throw new Error('Choose a simpler or smaller profile photo.'); return result;
  } finally { bitmap.close(); }
}
