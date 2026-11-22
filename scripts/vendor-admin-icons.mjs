import { writeFile } from 'node:fs/promises';

// Official Lucide SVGs, vendored so the admin does not depend on a third-party script.
const names = ['layout-dashboard', 'inbox', 'star', 'panels-top-left', 'external-link', 'chevron-down', 'send', 'mails', 'paperclip', 'search', 'refresh-cw', 'truck', 'map-pin', 'user-round', 'message-square', 'phone', 'mail', 'clock', 'image', 'monitor', 'smartphone', 'eye', 'x', 'log-out', 'settings-2', 'calendar-days', 'clipboard-list', 'check', 'book-open'];
const symbols = await Promise.all(names.map(async name => {
  const response = await fetch('https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/' + name + '.svg');
  if (!response.ok) throw new Error('Icon unavailable: ' + name);
  const svg = await response.text();
  return '<symbol id="' + name + '" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + svg.replace(/<svg[^>]*>|<\/svg>/g, '').trim() + '</g></symbol>';
}));
await writeFile('public/assets/admin-icons.svg', '<svg xmlns="http://www.w3.org/2000/svg">\n<!-- Lucide icons, ISC license. See lucide-license.txt. -->\n' + symbols.join('\n') + '\n</svg>\n');
console.log('Vendored ' + names.length + ' Lucide icons.');
