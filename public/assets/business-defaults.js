import { originalImages } from './site-media.js';
export const defaults = {
  businessName: 'RS on the Go LLC',
  headline: 'Towing & hauling across North Carolina',
  description: 'We handle breakdowns, scheduled vehicle and equipment moves, and long-distance freight.',
  location: 'Charlotte, NC',
  hoursNote: 'Available 24/7',
  phone: '+12392465837',
  email: 'ronthego586@gmail.com',
  serviceArea: 'Based in Charlotte, serving North Carolina and taking long-distance requests. Share your route so we can confirm coverage.',
  replyExpectation: 'We’ll contact you to confirm availability, price, and pickup details.',
  availabilityMessage: '',
  availabilityExpires: '',
  heroImage: originalImages.hero,
  contactImage: originalImages.contact,
  services: [
    { title: 'Vehicle towing & transport', description: 'Local towing and longer-distance transport for cars, trucks, SUVs, and vehicles that can’t be driven.' },
    { title: 'Equipment hauling', description: 'Skid steers, tractors, and other construction or agricultural equipment. Schedule one move or recurring pickups.' },
    { title: 'Freight & cargo transport', description: 'Flatbed hauling for palletized freight, oversized cargo, and time-sensitive loads. Share the load dimensions when requesting a quote.' },
  ],
  gallery: [
    { ...originalImages.gallery0, caption: 'Equipment transport' },
    { ...originalImages.gallery1, caption: 'Flatbed freight' },
  ],
  faqs: [
    { question: 'What areas do you serve?', answer: 'We’re based in Charlotte and serve North Carolina. We also take long-distance and interstate jobs. Include both locations so we can confirm your route.' },
    { question: 'Can you move a vehicle that won’t start?', answer: 'Yes. Tell us if the vehicle can roll, steer, and brake so we can plan the pickup.' },
    { question: 'Can I schedule a haul in advance?', answer: 'Yes. Include your preferred pickup date when requesting a quote. Call to check availability for an urgent job.' },
    { question: 'What information do you need for a quote?', answer: 'Send the pickup and drop-off addresses or cities, what needs to be moved, and your preferred timing. For equipment or freight, include the dimensions and weight if you know them.' },
    { question: 'How is a quote worked out?', answer: 'Share the route, vehicle or load details, and timing. We’ll review the job with you and confirm a price before you book.' },
  ],
};

export const usStates = 'AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|DC District of Columbia|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming'
  .split('|').map(state => [state.slice(0, 2), state.slice(3)]);
