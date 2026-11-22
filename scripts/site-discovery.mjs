import { readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { defaults } from '../public/assets/business-defaults.js';

const pages = [
  { file: 'index.html', path: '/' },
  { file: 'reviews/index.html', path: '/reviews/' },
  { file: 'privacy/index.html', path: '/privacy/' },
];
const start = '<!-- site-discovery:start -->';
const end = '<!-- site-discovery:end -->';

export function publishedOrigin(env) {
  if (env.CONTEXT !== 'production') return '';
  const value = env.RS_CANONICAL_URL?.trim() || env.URL?.trim();
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !url.hostname.includes('.') || url.hostname.endsWith('.localhost') || isIP(url.hostname)) throw new Error('Set the canonical website URL to the verified HTTPS origin.');
  return url.origin;
}

export function siteDiscovery(origin) {
  const absolute = path => new URL(path, origin).href;
  const business = {
    '@context': 'https://schema.org', '@type': 'Organization',
    '@id': absolute('/#organization'), name: defaults.businessName, url: absolute('/'),
    logo: absolute('/assets/rs-logo.webp'), telephone: defaults.phone,
    address: { '@type': 'PostalAddress', addressLocality: 'Charlotte', addressRegion: 'NC', addressCountry: 'US' },
    areaServed: [{ '@type': 'City', name: 'Charlotte' }, { '@type': 'State', name: 'North Carolina' }],
  };
  return {
    metadata: pages.map(page => ({
      ...page,
      markup: '<link rel="canonical" href="' + absolute(page.path) + '">' + (page.path === '/' ?
        '\n  <script type="application/ld+json">' + JSON.stringify(business).replaceAll('<', '\\u003c') + '</script>' : ''),
    })),
    sitemap: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      pages.map(page => '  <url><loc>' + absolute(page.path) + '</loc></url>').join('\n') + '\n</urlset>\n',
    robots: 'User-agent: *\nAllow: /\nSitemap: ' + absolute('/sitemap.xml') + '\n',
  };
}

export async function emitSiteDiscovery({ env = process.env, directory = 'public' } = {}) {
  const origin = publishedOrigin(env);
  if (!origin) return;
  const { metadata, sitemap, robots } = siteDiscovery(origin);
  await Promise.all([
    ...metadata.map(async ({ file, markup }) => {
      const path = directory + '/' + file;
      const html = await readFile(path, 'utf8');
      const from = html.indexOf(start);
      const to = html.indexOf(end);
      const clean = from >= 0 && to >= from ? html.slice(0, from) + html.slice(to + end.length).replace(/^\r?\n/, '') : html;
      await writeFile(path, clean.replace('</head>', start + '\n  ' + markup + '\n  ' + end + '\n</head>'));
    }),
    writeFile(directory + '/sitemap.xml', sitemap),
    writeFile(directory + '/robots.txt', robots),
  ]);
}
