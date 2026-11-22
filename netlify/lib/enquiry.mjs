import { enquiryStatuses } from '../../src/domain/jobs/types.ts';
import { validDate } from '../../src/domain/jobs/dates.ts';
import { text } from './validation.mjs';

export function validateEnquiry(body, previous) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!enquiryStatuses.includes(body.status)) fail('Choose a valid status.');
  const note = text(body.note, 2000, 'private note');
  const followUp = text(body.followUp, 10, 'follow-up date');
  const scheduledDate = text(body.scheduledDate ?? previous?.scheduledDate ?? '', 10, 'pickup date');
  const scheduledTime = text(body.scheduledTime ?? previous?.scheduledTime ?? '', 5, 'pickup time');
  if ((followUp && !validDate(followUp)) || (scheduledDate && !validDate(scheduledDate)) ||
      (scheduledTime && (!scheduledDate || !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime)))) {
    fail('Check the pickup and follow-up dates.');
  }
  let priceCents = previous?.priceCents ?? null;
  if (Object.hasOwn(body, 'agreedPrice')) {
    const value = text(body.agreedPrice, 10, 'agreed price');
    if (value && !/^\d{1,7}(?:\.\d{1,2})?$/.test(value)) fail('Enter a USD amount up to $9,999,999.99, or leave it blank.');
    const [whole, fraction = ''] = value.split('.');
    priceCents = value ? Number(whole) * 100 + Number(fraction.padEnd(2, '0')) : null;
  }
  return { status: body.status, note, followUp, scheduledDate, scheduledTime, priceCents };
}
