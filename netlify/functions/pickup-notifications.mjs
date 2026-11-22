import { mailSettings, runNotifications } from '../lib/notification-mail.mjs';

export const config = { schedule: '*/15 * * * *' };

export default async function scheduledNotifications() {
  const settings = mailSettings();
  if (settings && (settings.quotes || settings.pickups)) await runNotifications(settings);
  return new Response(null, { status: 204 });
}
