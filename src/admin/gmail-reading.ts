import { mailElements, safeMailUrl, type FormattedMail, type MailAttachment, type MailContent } from '../domain/mail/content.ts';

const webAddress = /(?<![\w@:/])https?:\/\/[^\s<>"'\x00-\x1f\x7f]+/giu;

function withoutTrailingPunctuation(address: string) {
  const trimmed = address.replace(/[.,;!?]+$/u, '');
  const unbalanced = (trimmed.match(/\)/g)?.length ?? 0) - (trimmed.match(/\(/g)?.length ?? 0);
  const ending = trimmed.match(/\)+$/)?.[0].length ?? 0;
  return trimmed.slice(0, trimmed.length - Math.max(0, Math.min(unbalanced, ending)));
}

function mailAnchor(document: Document, target: URL, label: string) {
  const anchor = document.createElement('a');
  anchor.href = target.href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.title = target.href;
  const visibleLabel = label.trim();
  const visibleUrl = safeMailUrl(visibleLabel);
  if (!visibleLabel || visibleUrl) {
    anchor.classList.add('gmail-raw-link');
    const path = target.pathname === '/' ? '' : target.pathname;
    anchor.textContent = target.host + (path.length > 28 ? path.slice(0, 27) + '…' : path);
    if (path.length <= 28 && (target.search || target.hash)) anchor.append('…');
  } else {
    anchor.textContent = visibleLabel;
  }
  anchor.setAttribute('aria-label', anchor.textContent + ' (opens ' + target.host + ' in a new tab)');
  return anchor;
}

function appendLinkedText(parent: HTMLElement, text: string) {
  let offset = 0;
  for (const match of text.matchAll(webAddress)) {
    const candidate = withoutTrailingPunctuation(match[0]);
    const url = safeMailUrl(candidate);
    if (!url) continue;
    parent.append(text.slice(offset, match.index), mailAnchor(parent.ownerDocument, url, candidate));
    offset = match.index + candidate.length;
  }
  parent.append(text.slice(offset));
}

const labelOf = (nodes: MailContent[]): string => nodes.map(node => typeof node === 'string' ? node : labelOf(node.children)).join('');

function appendMailContent(parent: HTMLElement, content: MailContent[], linkify = true) {
  const document = parent.ownerDocument;
  for (const part of content) {
    if (typeof part === 'string') {
      if (linkify) appendLinkedText(parent, part);
      else parent.append(part);
    } else if (part.tag === 'a') {
      const url = safeMailUrl(part.href);
      const label = labelOf(part.children).trim();
      if (label) parent.append(url ? mailAnchor(document, url, label) : label);
    } else if (mailElements.has(part.tag)) {
      const element = document.createElement(part.tag);
      appendMailContent(element, part.children, linkify && !['pre', 'code'].includes(part.tag));
      if (part.tag === 'table') {
        const tableScroll = document.createElement('div');
        tableScroll.className = 'gmail-table-scroll';
        tableScroll.append(element);
        parent.append(tableScroll);
      } else parent.append(element);
    }
  }
}

export function mailReadingBody(document: Document, body: string, content?: MailContent[]) {
  const wrapper = document.createElement('div');
  wrapper.className = 'gmail-message-body';
  if (content?.length) {
    appendMailContent(wrapper, content);
  } else {
    wrapper.classList.add('is-plaintext');
    for (const block of body.trim().split(/\r?\n[ \t]*\r?\n+/)) {
      const paragraph = document.createElement('p');
      appendLinkedText(paragraph, block);
      wrapper.append(paragraph);
    }
  }
  return wrapper;
}

// Only formattedMail() output goes into srcdoc. The sandbox and CSP also isolate
// it from the workspace and gate external images independently of the renderer.
export function mailFormattedView(article: HTMLDetailsElement, formatted: FormattedMail) {
  const document = article.ownerDocument;
  const section = document.createElement('div');
  section.className = 'gmail-formatted';
  const frame = document.createElement('iframe');
  frame.className = 'gmail-format-frame';
  frame.title = 'Formatted email';
  frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('credentialless', '');
  frame.referrerPolicy = 'no-referrer';

  function show(images: boolean) {
    const markup = images ? formatted.html.replaceAll(' data-mail-src="', ' decoding="async" src="') : formatted.html;
    const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:" +
      (images ? " https:" : "") + "; base-uri 'none'; form-action 'none'";
    frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + policy +
      '"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<style>html{color-scheme:light}body{display:flow-root;margin:0;color:#202b3a;background:#fff;' +
      'font:15px/1.55 system-ui,sans-serif;overflow-wrap:anywhere;padding:16px}' +
      'table,img{max-width:100%}img{height:auto}img:is([data-mail-src],[data-mail-cid]){display:none!important}' +
      'a{color:#174f88;text-underline-offset:.12em}a:focus-visible{outline:2px solid #174f88;outline-offset:2px}' +
      'pre{white-space:pre-wrap}' +
      '@media(max-width:620px){body{padding:10px}table{width:auto!important;max-width:100%!important}' +
      'table[width="100%"]{width:100%!important}td,th{width:auto!important}' +
      'td,th,div{padding-inline:min(3vw,12px)!important}' +
      'div,p{max-width:100%!important;box-sizing:border-box}img{height:auto!important}}' +
      '</style></head><body>' + markup + '</body></html>';
  }
  let observer: ResizeObserver | undefined;
  frame.addEventListener('load', () => {
    observer?.disconnect();
    const body = frame.contentDocument?.body;
    const view = frame.contentWindow;
    if (!body || !view) return;
    const resize = () => {
      if (!frame.isConnected) return;
      const border = frame.offsetHeight - frame.clientHeight;
      frame.style.height = Math.min(50_000, Math.max(48, body.scrollHeight + border)) + 'px';
    };
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      const active = observer = new ResizeObserver(resize);
      active.observe(body);
      view.addEventListener('pagehide', () => active.disconnect(), { once: true });
    }
  });
  section.append(frame);
  let automatic = false;
  let rendered: boolean | undefined;
  function update() {
    if ((!article.open && (automatic || rendered === undefined)) || rendered === automatic) return;
    rendered = automatic;
    show(automatic);
  }
  article.addEventListener('toggle', update);
  return {
    section,
    setAutomaticImages(enabled: boolean) {
      automatic = enabled && formatted.hasImages;
      update();
    },
  };
}

export function originalMailLink(document: Document, gmailUrl: string) {
  const link = document.createElement('a');
  link.className = 'gmail-original-link';
  link.href = gmailUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Open full email in Gmail';
  return link;
}

function previewLinks(content: MailContent[]) {
  const labels = new Map<string, { label: string; target: URL; ambiguous: boolean }>();
  function collect(parts: MailContent[]) {
    for (const part of parts) {
      if (typeof part === 'string') continue;
      if (part.tag !== 'a') {
        collect(part.children);
        continue;
      }
      const target = safeMailUrl(part.href);
      const label = labelOf(part.children).trim().replace(/\s+/g, ' ');
      if (!target || !label || /^(?:https?:\/\/|www\.|click here\b)/i.test(label)) continue;
      const key = label.toLowerCase();
      const existing = labels.get(key);
      if (existing) existing.ambiguous ||= target.href !== existing.target.href;
      else labels.set(key, { label, target, ambiguous: false });
    }
  }
  collect(content);
  return [...labels.values()].filter(link => !link.ambiguous).slice(0, 6);
}

export function mailVisualPreview(document: Document, message: { summary: string; content?: MailContent[] }, gmailUrl: string) {
  const panel = document.createElement('section');
  panel.className = 'gmail-visual-preview';
  const intro = document.createElement('div');
  intro.className = 'gmail-preview-intro';
  const title = document.createElement('h3');
  title.textContent = 'Image-rich email';
  const summary = document.createElement('p');
  summary.textContent = message.summary.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim() ||
    'Open this email in Gmail to see its images and original layout.';
  intro.append(title, summary, originalMailLink(document, gmailUrl));
  panel.append(intro);

  const links = previewLinks(message.content ?? []);
  if (links.length) {
    const heading = document.createElement('h4');
    heading.textContent = 'Links from this email';
    const list = document.createElement('ul');
    for (const { label, target } of links) {
      const row = document.createElement('li');
      const link = mailAnchor(document, target, label);
      const domain = document.createElement('bdi');
      domain.textContent = target.host;
      domain.setAttribute('aria-hidden', 'true');
      link.append(domain);
      row.append(link);
      list.append(row);
    }
    panel.append(heading, list);
  }
  return panel;
}

const kilobytes = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 1 });
const megabytes = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 });
const attachmentSize = (size: number) => size >= 1_000_000 ? megabytes.format(size / 1_000_000) : kilobytes.format(size / 1000);

export function mailAttachments(document: Document, attachments: MailAttachment[], gmailUrl: string) {
  const group = document.createElement('section');
  group.className = 'gmail-attachments';
  const heading = document.createElement('h3');
  heading.textContent = attachments.length === 1 ? '1 attachment' : attachments.length + ' attachments';
  const files = document.createElement('ul');
  for (const attachment of attachments) {
    const file = document.createElement('li');
    const type = document.createElement('span');
    type.className = 'gmail-file-type';
    type.setAttribute('aria-hidden', 'true');
    type.textContent = attachment.name.match(/\.([a-z\d]{1,4})$/i)?.[1].toUpperCase() || 'File';
    const description = document.createElement('div');
    description.className = 'gmail-file-description';
    const name = document.createElement('strong');
    name.textContent = attachment.name;
    description.append(name);
    if (attachment.size != null) {
      const size = document.createElement('span');
      size.textContent = attachmentSize(attachment.size);
      description.append(size);
    }
    file.append(type, description);
    files.append(file);
  }
  const open = document.createElement('a');
  open.href = gmailUrl;
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = 'Open attachments in Gmail';
  group.append(heading, files, open);
  return group;
}
