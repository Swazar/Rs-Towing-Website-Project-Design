import { defaults } from '../../public/assets/business-defaults.js';

import { upgradeHaulingContent } from './website-content.mjs';

export function workspaceKnowledge(permissions) {
  const facts = [
    'Overview shows a summary, job locations, the pickup calendar, and follow-ups. Local preview uses test records.',
    'Enquiries supports search by job number, customer, route, or service. Open an enquiry to see its route, contact actions, and Notes & status.',
    'In Notes & status, set a confirmed pickup date and time after speaking to the customer. Set status to Booked and save. Pickup times follow Eastern Time. Requested dates are separate.',
    'In Notes & status, enter the agreed USD price, a private note, and optional follow-up date, then save.',
    'A job number such as RS-202611-VEH-0001 contains the business prefix, Eastern month the quote arrived, service, and sequence. Current service codes are VEH, EQP, FRT, and GEN.',
    'Settings saves the profile, timezone, color theme, and workspace preferences. Desktop presets control layout, text, and spacing. Mobile has one layout. Select Save changes to apply settings.',
    'Hosted admins use invited accounts. The workspace signs out after 30 minutes of inactivity and has a 12-hour maximum. Forgot password is on the sign-in screen. Google sign-in depends on the hosting configuration.',
    'Quote and review forms are public. Customers can call dispatch to discuss the route, load, or pickup date for a haul.',
  ];
  if (permissions.includes('content')) facts.push(
    'In Website, open the section, make the edit, review Full website preview, and select Publish changes.',
    'Owners can use Version history beside Website publish controls or in Notes & status for a job. Restoring website content publishes that version and keeps the displaced version.',
    'Optional quote alerts and a daily next-day pickup digest use the production email configuration. The assistant cannot verify delivery or inspect server logs.',
  );
  if (permissions.includes('reviews')) facts.push('Reviews has three homepage slots at the top. Select an empty slot and choose Add to homepage on an eligible review. If all three slots are filled, remove a review to make room. Private feedback stays inside the workspace.');
  if (permissions.includes('export')) facts.push('Owners can export the filtered enquiry list as CSV from More filters.');
  return facts;
}

export function websiteKnowledge(saved) {
  const data = upgradeHaulingContent(saved || defaults);
  const pick = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
  return {
    business: pick(data.businessName, 80),
    location: pick(data.location, 100),
    hours: pick(data.hoursNote, 80),
    serviceArea: pick(data.serviceArea, 350),
    services: (Array.isArray(data.services) ? data.services : defaults.services).slice(0, 3)
      .map(service => ({ title: pick(service?.title, 80), description: pick(service?.description, 350) })),
    quoteProcess: pick(data.replyExpectation, 350),
  };
}
