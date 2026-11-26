import { originalImages } from './site-media.js';
export const defaults = {
  businessName: 'RS on the Go LLC',
  headline: 'Hauling across North Carolina',
  description: 'Plan a vehicle, equipment, or freight haul from Charlotte. Tell us what you’re moving and where it needs to go.',
  location: 'Charlotte, NC',
  hoursNote: 'Available 24/7',
  phone: '+12392465837',
  email: 'rsonthegodispatch@gmail.com',
  serviceArea: 'Based in Charlotte, serving North Carolina and taking long-distance requests. Share your route so we can confirm coverage.',
  replyExpectation: 'We’ll contact you to confirm availability, price, and pickup details.',
  availabilityMessage: '',
  availabilityExpires: '',
  heroImage: originalImages.hero,
  contactImage: originalImages.contact,
  services: [
    { title: 'Scheduled vehicle hauling', description: 'Schedule trailer transport for a car, pickup, or SUV. Share the vehicle type and both locations so we can plan loading and delivery.' },
    { title: 'Equipment hauling', description: 'Skid steers, tractors, and other construction or agricultural equipment. Schedule one move or recurring pickups.' },
    { title: 'Freight & cargo transport', description: 'Flatbed hauling for palletized freight, oversized cargo, and time-sensitive loads. Share the load dimensions when requesting a quote.' },
  ],
  gallery: [
    { ...originalImages.gallery0, caption: 'Equipment transport' },
    { ...originalImages.gallery1, caption: 'Flatbed freight' },
  ],
  faqs: [
    { question: 'What areas do you serve?', answer: 'We’re based in Charlotte and serve North Carolina. We also take long-distance and interstate jobs. Include both locations so we can confirm your route.' },
    { question: 'What should I measure before pickup?', answer: 'Share the length, width, height, and approximate weight of the load. For equipment, include any attachments traveling with it.' },
    { question: 'Can I schedule a haul in advance?', answer: 'Yes. Include your preferred pickup date and both locations. Dispatch will confirm availability for your route.' },
    { question: 'What information do you need for a quote?', answer: 'Send the pickup and drop-off addresses or cities, what needs to be moved, and your preferred timing. For equipment or freight, include the dimensions and weight if you know them.' },
    { question: 'How is a quote worked out?', answer: 'Share the route, vehicle or load details, and timing. We’ll review the job with you and confirm a price before you book.' },
  ],
};

export const usStates = 'AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|DC District of Columbia|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming'
  .split('|').map(state => [state.slice(0, 2), state.slice(3)]);
