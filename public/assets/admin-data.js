import { dateKey, validDate } from '../../src/domain/jobs/dates.ts';
import { isQuote } from '../../src/domain/jobs/types.ts';
export { dateKey, businessDateKey, validDate } from '../../src/domain/jobs/dates.ts';
export { csvCell, enquiryCSV, filterEnquiries } from '../../src/domain/jobs/queries.ts';
export function calendarEvents(items, reminders = []) {
  const events = [];
  for (const item of items) {
    if (!isQuote(item) || item.state?.status === 'Closed') continue;
    const name = item.data.name || 'Customer';
    if (validDate(item.state?.scheduledDate)) events.push({ id: item.id + '-pickup', itemId: item.id, date: item.state.scheduledDate, time: item.state.scheduledTime || '', title: name, kind: 'pickup', label: 'Confirmed pickup' });
    else if (validDate(item.data.pickup_date)) events.push({ id: item.id + '-requested', itemId: item.id, date: item.data.pickup_date, title: name, kind: 'requested', label: 'Requested pickup · unconfirmed' });
    if (validDate(item.state?.followUp)) events.push({ id: item.id + '-followup', itemId: item.id, date: item.state.followUp, title: name, kind: 'followup', label: 'Follow-up' });
  }
  for (const task of reminders) if (validDate(task.date)) events.push({ id: task.id, date: task.date, title: task.title, done: task.done, kind: 'reminder', label: 'Reminder' });
  return events.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title));
}
export function monthDays(year, month) {
  const first = new Date(year, month, 1), start = new Date(year, month, 1 - first.getDay());
  const count = Math.ceil((first.getDay() + new Date(year, month + 1, 0).getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, index) => { const day = new Date(start); day.setDate(day.getDate() + index); return { date: dateKey(day), day: day.getDate(), inMonth: day.getMonth() === month }; });
}
const normalize = value => String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function locationPoint(item, name, places) {
  const raw = String(item.data[name + '_point'] || '');
  if (raw) {
    const point = raw.split(',').map(Number);
    if (point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180) return { point, approximate: Boolean(places?.some(([label]) => normalize(label) === normalize(item.data[name]))) || item.data[name + '_accuracy'] === 'Street only' };
  }
  // Manual street locations must not silently turn into a guessed street pin.
  if (item.data[name + '_accuracy']?.startsWith('Manual')) return null;
  const match = places?.find(([label]) => normalize(label) === normalize(item.data[name]));
  return match ? { point: match.slice(1, 3), approximate: true } : null;
}
