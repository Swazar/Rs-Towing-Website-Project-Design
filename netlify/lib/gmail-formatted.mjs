import { parseDocument } from 'htmlparser2';
import { safeMailUrl } from '../../src/domain/mail/content.ts';

const tags = new Set('a b blockquote br caption center code del div em h1 h2 h3 h4 h5 h6 hr i img li ol p pre s small span strong sub sup table tbody td th thead tfoot tr u ul'.split(' '));
const voidTags = new Set(['br', 'hr', 'img']);
const discard = new Set('audio button embed form head iframe input math noscript object script select style svg template textarea video'.split(' '));
const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const attribute = (name, value) => ' ' + name + '="' + escape(value) + '"';
const color = /^(?:#[a-f0-9]{3,8}|[a-z]{1,22}|rgba?\([\d.%, /]+\))$/i;
const length = /^(?:auto|0|\d{1,3}(?:\.\d{1,2})?(?:px|pt|rem|em|%))$/i;
const space = /^(?:0|\d{1,2}(?:\.\d{1,2})?(?:px|pt|rem|em|%))(?:\s+(?:0|\d{1,2}(?:\.\d{1,2})?(?:px|pt|rem|em|%))){0,3}$/i;
const alignment = /^(?:left|right|center|start|end|justify)$/i;
const vertical = /^(?:top|middle|bottom|baseline)$/i;
const styles = {
  color, 'background-color': color, background: color, 'border-color': color,
  width: length, 'max-width': length, height: length,
  'font-size': length, 'border-radius': length, 'line-height': /^(?:normal|[0-9](?:\.\d{1,2})?|\d{1,3}(?:px|pt|%))$/i,
  'font-family': /^[a-z0-9 ,'"-]{1,120}$/i,
  'font-weight': /^(?:normal|bold|bolder|lighter|[1-9]00)$/i,
  'font-style': /^(?:normal|italic|oblique)$/i,
  'text-align': alignment, 'vertical-align': vertical,
  'text-decoration': /^(?:none|underline|line-through)$/i,
  'border-collapse': /^(?:collapse|separate)$/i,
  'border-style': /^(?:none|solid|dashed|dotted)$/i,
  'border-width': space,
  display: /^(?:block|inline|inline-block)$/i,
};

function presentation(name, attrs) {
  let html = '';
  const safe = [];
  if (color.test(attrs.bgcolor || '')) safe.push('background-color:' + attrs.bgcolor);
  for (const declaration of (attrs.style || '').slice(0, 4000).split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 1) continue;
    const key = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim().replace(/\s*!important$/i, '');
    const validator = /^(?:margin|padding)(?:-(?:top|bottom|left|right))?$/.test(key)
      ? space : Object.hasOwn(styles, key) ? styles[key] : null;
    if (validator?.test(value) || (key === 'margin' && value === '0 auto')) safe.push(key + ':' + value);
  }
  if (safe.length) html += attribute('style', safe.join(';'));
  for (const key of ['width', 'height', 'cellpadding', 'cellspacing', 'colspan', 'rowspan']) {
    if (/^\d{1,3}%?$/.test(attrs[key] || '')) html += attribute(key, attrs[key]);
  }
  if (alignment.test(attrs.align || '')) html += attribute('align', attrs.align);
  if (vertical.test(attrs.valign || '')) html += attribute('valign', attrs.valign);
  if (name === 'table' && attrs.role === 'presentation') html += ' role="presentation"';
  if (/^(?:ltr|rtl|auto)$/.test(attrs.dir || '')) html += attribute('dir', attrs.dir);
  return html;
}

export function mailContentId(value) {
  return value.trim().replace(/^<([^<>]+)>$/, '$1');
}

function inlineImageIndex(value, inlineImages) {
  if (!/^cid:/i.test(value ?? '')) return undefined;
  try { return inlineImages.get(mailContentId(decodeURIComponent(value.slice(4))))?.index; }
  catch { return undefined; }
}

export function formattedMail(markup, inlineImages = new Map()) {
  const count = markup.reduce((total, part) => total + part.length, 0);
  if (!count || count > 240_000) return null;
  let externalImages = 0;
  let hasInlineImage = false;
  let hasText = false;
  let visited = 0;
  let bytes = 0;
  const output = [];
  const write = text => {
    bytes += Buffer.byteLength(text);
    output.push(text);
  };
  function render(nodes, depth) {
    for (const node of nodes) {
      if (++visited > 9_000 || depth > 65 || bytes > 90_000) return;
      if (node.type === 'text') {
        hasText ||= Boolean(node.data.trim());
        write(escape(node.data));
        continue;
      }
      const { name, attribs: attrs, children } = node;
      if (!attrs || discard.has(name) || Object.hasOwn(attrs, 'hidden') ||
        /(?:^|;)\s*(?:display:\s*none|visibility:\s*hidden|mso-hide:\s*all)\b/i.test((attrs.style || '').replace(/\s+:/g, ':'))) continue;
      const tag = name === 'body' ? 'div' : name;
      if (!tags.has(tag)) {
        render(children, depth + 1);
        continue;
      }
      let attributes = presentation(tag, attrs);
      if (tag === 'a') {
        const target = safeMailUrl(attrs.href);
        if (target) attributes += attribute('href', target.href) + attribute('title', target.host) + ' target="_blank" rel="noopener noreferrer"';
      }
      if (tag === 'img') {
        const index = inlineImageIndex(attrs.src, inlineImages);
        if (index !== undefined) {
          hasInlineImage = true;
          attributes += attribute('data-mail-cid', String(index));
        } else {
          const target = safeMailUrl(attrs.src);
          const host = target?.hostname.replace(/\.$/, '') || '';
          if (externalImages >= 100 || [attrs.width, attrs.height].some(value => /^(?:0|1)(?:px)?$/i.test(value?.trim() ?? '')) ||
            target?.protocol !== 'https:' || target.port || !/\.[a-z][a-z\d-]*$/i.test(host) ||
            /\.(?:internal|local|localhost|lan|home|test)$/i.test(host)) continue;
          externalImages++;
          attributes += attribute('data-mail-src', target.href);
        }
        attributes += attribute('alt', (attrs.alt || '').slice(0, 240));
      }
      write('<' + tag + attributes + '>');
      if (voidTags.has(tag)) continue;
      render(children, depth + 1);
      write('</' + tag + '>');
    }
  }
  render(parseDocument(markup.join('\n')).children, 0);
  if (bytes > 90_000 || visited > 9_000 || !(hasText || externalImages || hasInlineImage)) return null;
  return { html: output.join(''), hasImages: externalImages > 0 };
}
