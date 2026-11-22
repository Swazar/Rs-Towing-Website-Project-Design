import { priceLabel } from './enquiry-contact.js';

const websiteFields = {
  businessName: 'Business name', headline: 'Homepage headline', description: 'Introduction',
  location: 'Location', hoursNote: 'Business hours', phone: 'Phone', email: 'Email',
  serviceArea: 'Service area', replyExpectation: 'Reply notice', availabilityMessage: 'Availability notice',
  availabilityExpires: 'Availability expiry', services: 'Services', faqs: 'FAQs',
  heroImage: 'Homepage photo', contactImage: 'Contact photo', gallery: 'Job photos',
};

function display(value) {
  if (Array.isArray(value)) return value.map(entry => entry.title || entry.question || entry.caption).join(' · ');
  if (value && typeof value === 'object') return [value.alt, value.position].filter(Boolean).join(' · ');
  return value || '—';
}

export function recoveryPreview(data, current, job) {
  if (job) return [
    ['Status', data.status], ['Agreed price', priceLabel(data.priceCents)],
    ['Pickup (Eastern)', [data.scheduledDate, data.scheduledTime].filter(Boolean).join(' · ')],
    ['Follow-up date', data.followUp], ['Private note', data.note],
  ];
  return Object.entries(websiteFields)
    .filter(([key]) => JSON.stringify(data[key]) !== JSON.stringify(current?.[key]))
    .map(([key, label]) => [label, display(data[key])]);
}
