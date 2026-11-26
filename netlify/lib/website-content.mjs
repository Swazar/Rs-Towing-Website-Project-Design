import { defaults } from '../../public/assets/business-defaults.js';
import { originalImages, withMediaDefaults } from '../../public/assets/site-media.js';

// Prior releases persisted the built-in copy together with the owner's edits.
// Match the retired defaults exactly so unrelated edits and uploaded photos survive.
const replacements = new Map([
  ['Towing & hauling across North Carolina', defaults.headline],
  ['We handle breakdowns, scheduled vehicle and equipment moves, and long-distance freight.', defaults.description],
  ['Vehicle towing & transport', defaults.services[0].title],
  ['Local towing and longer-distance transport for cars, trucks, SUVs, and vehicles that can’t be driven.', defaults.services[0].description],
  ['Can you move a vehicle that won’t start?', defaults.faqs[1].question],
  ['Yes. Tell us if the vehicle can roll, steer, and brake so we can plan the pickup.', defaults.faqs[1].answer],
  ['Yes. Include your preferred pickup date when requesting a quote. Call to check availability for an urgent job.', defaults.faqs[2].answer],
]);

const upgradeText = value => replacements.get(value) ?? value;
const retiredPhoto = '/assets/towing-stock.webp';

export function upgradeHaulingContent(settings) {
  if (!settings) return settings;
  const next = { ...settings, headline: upgradeText(settings.headline), description: upgradeText(settings.description) };
  if (Array.isArray(settings.services)) next.services = settings.services.map(item =>
    item && { ...item, title: upgradeText(item.title), description: upgradeText(item.description) });
  if (Array.isArray(settings.faqs)) next.faqs = settings.faqs.map(item =>
    item && { ...item, question: upgradeText(item.question), answer: upgradeText(item.answer) });

  for (const slot of ['hero', 'contact']) {
    if (settings[slot + 'Image']?.src === retiredPhoto) next[slot + 'Image'] = { ...originalImages[slot] };
  }
  if (Array.isArray(settings.gallery)) next.gallery = settings.gallery.map((photo, index) =>
    photo?.src === retiredPhoto ? { ...defaults.gallery[index] } : photo);
  return next;
}

export function publishedWebsiteContent(saved) {
  const content = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, saved?.[key] ?? fallback]));
  return withMediaDefaults(upgradeHaulingContent(content));
}
