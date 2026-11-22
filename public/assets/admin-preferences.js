export const preferenceDefaults = { timeZone: 'America/New_York', timeFormat: '12h' };

export function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 100 || !value.trim()) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; }
  catch { return false; }
}
export function preferences(value = {}) {
  return { timeZone: validTimeZone(value?.timeZone) ? value.timeZone : preferenceDefaults.timeZone,
    timeFormat: value?.timeFormat === '24h' ? '24h' : '12h' };
}
export function formatTimestamp(value, settings) {
  if (!value) return '';
  const { timeZone, timeFormat } = preferences(settings);
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone, hourCycle: timeFormat === '12h' ? 'h12' : 'h23' }).format(new Date(value));
}
export function formatClock(value, settings) {
  const { timeZone, timeFormat } = preferences(settings);
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone, hourCycle: timeFormat === '12h' ? 'h12' : 'h23' }).format(value);
}
export function formatBusinessTime(value, settings) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return '';
  if (preferences(settings).timeFormat === '24h') return value;
  const [hour, minute] = value.split(':');
  return `${Number(hour) % 12 || 12}:${minute} ${Number(hour) < 12 ? 'AM' : 'PM'}`;
}
