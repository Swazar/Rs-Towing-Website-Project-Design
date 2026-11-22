import { mailSettings, enqueueQuote, deliverNotification } from '../lib/notification-mail.mjs';

export default {
  async formSubmitted({ data }) {
    const settings = mailSettings();
    const alert = await enqueueQuote(data, settings);
    if (alert) await deliverNotification(alert.key, alert.id, settings);
  },
};
