import { parseDocument } from 'htmlparser2';
import { mailElements, safeMailUrl } from '../../src/domain/mail/content.ts';

const ignored = new Set([
  'head', 'style', 'script', 'img', 'picture', 'svg', 'math', 'iframe', 'object',
  'embed', 'form', 'button', 'input', 'textarea', 'select', 'audio', 'video', 'noscript', 'template',
]);
const headingTags = new Map([['b', 'strong'], ['i', 'em'], ['h1', 'h3'], ['h2', 'h3'], ['h5', 'h4'], ['h6', 'h4']]);
const tableGroups = new Set(['thead', 'tbody', 'tfoot']);
const tableCells = new Set(['td', 'th']);
const inlineElements = new Set(['a', 'strong', 'em', 'del', 'code', 'br']);
const maxHtmlLength = 240_000;
export const maxMailText = 20_000;

function hasReadableContent(nodes) {
  return nodes.some(node => typeof node === 'string' ? Boolean(node.trim()) : hasReadableContent(node.children));
}

function rowsIn(nodes) {
  return nodes.flatMap(node => {
    if (typeof node === 'string') return [];
    if (node.tag === 'tr') return [node];
    return tableGroups.has(node.tag) ? rowsIn(node.children) : [];
  });
}

function hasTableHeaders(nodes) {
  return nodes.some(node => node?.tag === 'caption') || rowsIn(nodes).some(row =>
    row.children.some(cell => cell?.tag === 'th' && hasReadableContent(cell.children)));
}

const isInline = node => typeof node === 'string' || inlineElements.has(node.tag);

function cellText(nodes) {
  const pieces = nodes.filter(node => typeof node !== 'string' || node.trim());
  const [only] = pieces;
  if (pieces.length === 1 && (only?.tag === 'div' || only?.tag === 'p')) return cellText(only.children);
  return nodes;
}

function flattenTable(nodes) {
  return nodes.flatMap(node => {
    if (typeof node === 'string') return node.trim() ? [node] : [];
    if (tableGroups.has(node.tag)) return flattenTable(node.children);
    if (node.tag === 'caption') return [{ tag: 'p', children: node.children }];
    if (tableCells.has(node.tag)) return node.children;
    if (node.tag !== 'tr') return [node];

    const cells = node.children
      .filter(cell => tableCells.has(cell?.tag) && hasReadableContent(cell.children))
      .map(cell => cellText(cell.children));
    if (!cells.length) return [];
    if (cells.every(cell => cell.every(isInline))) {
      return [{ tag: 'p', children: cells.flatMap((cell, index) => index ? [' · ', ...cell] : cell) }];
    }
    return cells.flatMap(cell => cell.every(isInline) ? [{ tag: 'p', children: cell }] : cell);
  });
}

function hiddenElement(attributes) {
  return 'hidden' in attributes || attributes['aria-hidden'] === 'true' ||
    /(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(attributes.style ?? '');
}

function shortLabel(value) {
  const text = (value ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const generic = /^(?:(?:an?|the)\s+)?(?:image|photo|picture|logo|icon|spacer|pixel|button|banner)(?:\s*\d+)?[.!]?$/i;
  return text && !generic.test(text) && !safeMailUrl(text) ? text : '';
}

function linkedImageLabel(nodes, depth = 0) {
  if (depth > 16) return '';
  for (const node of nodes) {
    if (node.type !== 'tag' || hiddenElement(node.attribs)) continue;
    const label = node.name === 'img' ? shortLabel(node.attribs.alt) : linkedImageLabel(node.children, depth + 1);
    if (label) return label;
  }
  return '';
}

function readableChildren(nodes, budget, depth = 0) {
  if (depth > 30) {
    budget.truncated = true;
    return [];
  }
  const output = [];
  for (const node of nodes) {
    if (budget.nodes <= 0 || budget.text <= 0) {
      budget.truncated = true;
      break;
    }
    budget.nodes--;
    if (node.type === 'text') {
      const text = node.data.slice(0, budget.text);
      budget.text -= text.length;
      if (text.length < node.data.length) budget.truncated = true;
      output.push(text);
    }
    if (node.type !== 'tag') continue;
    const attributes = node.attribs;
    if (hiddenElement(attributes)) continue;
    if (node.name === 'img' && (attributes.src || attributes.srcset) &&
        ![attributes.width, attributes.height].some(dimension => /^\s*(?:0|1)(?:px)?\s*$/i.test(dimension ?? ''))) {
      budget.simplified = true;
      budget.images++;
    }
    if (ignored.has(node.name)) continue;
    const children = readableChildren(node.children, budget, depth + 1);
    const tag = headingTags.get(node.name) ?? node.name;
    const hasText = hasReadableContent(children);
    if (tag === 'a') {
      const target = safeMailUrl(attributes.href);
      const fallback = hasText ? '' : shortLabel(attributes['aria-label']) ||
        linkedImageLabel(node.children) || shortLabel(attributes.title);
      if (target && (!hasText || budget.links <= 0)) {
        budget.simplified = true;
        if (!hasText) budget.imageLinks++;
      }
      if (target && (hasText || fallback) && budget.links > 0) {
        budget.links--;
        budget.text -= fallback.length;
        output.push({ tag, href: target.href, children: hasText ? children : [fallback] });
      } else {
        output.push(...children);
      }
    } else if (tag === 'table' && hasText) {
      const role = attributes.role?.trim().toLowerCase();
      const dataTable = role === 'table' || (role !== 'presentation' && role !== 'none' && hasTableHeaders(children));
      if (dataTable) output.push({ tag, children });
      else {
        budget.layouts++;
        output.push(...flattenTable(children));
      }
    } else if (mailElements.has(tag) && (hasText || tableCells.has(tag) || tag === 'br' || tag === 'hr')) {
      output.push({ tag, children });
    } else if (!mailElements.has(tag)) output.push(...children);
  }
  return output;
}

export function readableMailHtml(parts) {
  const html = parts.join('\n');
  const document = parseDocument(html.slice(0, maxHtmlLength));
  const budget = {
    text: maxMailText, nodes: 900, links: 80, truncated: html.length > maxHtmlLength, simplified: false,
    images: 0, imageLinks: 0, layouts: 0,
  };
  const content = readableChildren(document.children, budget);
  const imageHeavy = budget.images >= 6 || (budget.images >= 2 && budget.layouts >= 3) || budget.imageLinks >= 4;
  return { content: hasReadableContent(content) ? content : [], truncated: budget.truncated || budget.simplified, imageHeavy };
}
