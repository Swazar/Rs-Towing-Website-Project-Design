import { defaults, usStates } from '../../public/assets/business-defaults.js';
import { originalImages, builtinImage, imageId, imagePositions } from '../../public/assets/site-media.js';

export function validateImage(image, fallback, label) {
  if (!image) return { ...fallback };
  if (!builtinImage(image.src) && !imageId(image.src)) throw Object.assign(new Error('Select an uploaded or original ' + label + '.'), { status: 400 });
  if (!Object.hasOwn(imagePositions, image.position)) throw Object.assign(new Error('Choose an image alignment.'), { status: 400 });
  return { src: image.src, alt: text(image.alt, 180, label + ' description', true), position: image.position };
}

export function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw Object.assign(new Error(`Check ${label}.`), { status: 400 });
  }
  return value.trim();
}

export function validateSettings(body) {
  const result = {};
  const limits = { businessName: 80, headline: 120, description: 350, location: 100, hoursNote: 80, phone: 25, email: 254,
    serviceArea: 350, replyExpectation: 350, availabilityMessage: 200, availabilityExpires: 30 };
  for (const [key, max] of Object.entries(limits)) {
    result[key] = text(body?.[key], max, key, !['availabilityMessage', 'availabilityExpires'].includes(key));
  }
  if (!/^\+?\d[\d ()-]{6,24}$/.test(result.phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) {
    throw Object.assign(new Error('Check the contact phone and email.'), { status: 400 });
  }
  if (result.availabilityMessage && (!result.availabilityExpires || !Number.isFinite(Date.parse(result.availabilityExpires)))) {
    throw Object.assign(new Error('Set an expiry for the temporary availability message.'), { status: 400 });
  }
  if (!Array.isArray(body?.services) || body.services.length !== 3 ||
      !Array.isArray(body?.faqs) || body.faqs.length < 1 || body.faqs.length > 6 ||
      !Array.isArray(body?.gallery) || body.gallery.length !== 2) {
    throw Object.assign(new Error('Check the services, FAQs, and gallery.'), { status: 400 });
  }
  result.services = body.services.map(item => ({
    title: text(item.title, 80, 'service title', true), description: text(item.description, 350, 'service description', true),
  }));
  result.faqs = body.faqs.map(item => ({
    question: text(item.question, 150, 'FAQ question', true), answer: text(item.answer, 600, 'FAQ answer', true),
  }));
  result.heroImage = validateImage(body.heroImage, originalImages.hero, 'homepage photo');
  result.contactImage = validateImage(body.contactImage, originalImages.contact, 'contact photo');
  result.gallery = body.gallery.map((item, index) => ({ ...validateImage({ ...(builtinImage(item.src) || originalImages['gallery' + index]), ...item }, originalImages['gallery' + index], 'gallery photo'), caption: text(item.caption, 120, 'photo caption', true) }));
  return result;
}

export function validateSubmission(data) {
  const name = data['form-name'];
  if (!['quote-request', 'customer-review'].includes(name)) throw Object.assign(new Error('Unknown form.'), { status: 400 });
  if (data['bot-field']) throw Object.assign(new Error('Submission could not be accepted.'), { status: 400 });
  if (name === 'customer-review') {
    text(data.review, 800, 'feedback', true);
    if (![1, 2, 3, 4, 5].includes(Number(data.rating))) throw Object.assign(new Error('Choose a rating.'), { status: 400 });
  } else {
    for (const [field, max] of [['pickup', 350], ['dropoff', 350], ['name', 120], ['phone', 40], ['service', 80], ['details', 2000]]) {
      text(data[field], max, field, true);
    }
    if (!['Today', 'Specific date', 'Flexible'].includes(data.pickup_timing)) {
      throw Object.assign(new Error('Choose pickup timing.'), { status: 400 });
    }
    if (data.pickup_timing === 'Specific date' && !/^\d{4}-\d{2}-\d{2}$/.test(data.pickup_date || '')) {
      throw Object.assign(new Error('Choose a preferred pickup date.'), { status: 400 });
    }
    for (const field of ['pickup_state', 'dropoff_state']) {
      if (data[field] && !usStates.some(([code]) => code === data[field])) throw Object.assign(new Error('Choose a U.S. state.'), { status: 400 });
    }
  }
  return data;
}

export function publicReview(submission, state) {
  const data = submission.data;
  if (state?.publication !== 'Published' || data['publish-permission'] !== 'yes' ||
      ![1, 2, 3, 4, 5].includes(Number(data.rating)) || !data.review?.trim()) return null;
  return {
    name: data.first_name?.trim() || 'Customer',
    quote: data.review,
    rating: Number(data.rating),
    date: submission.created_at.slice(0, 10),
  };
}
