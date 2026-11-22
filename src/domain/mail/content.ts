export const mailElements = new Set([
  'p', 'div', 'br', 'hr', 'strong', 'em', 'del', 'h3', 'h4', 'blockquote',
  'pre', 'code', 'ol', 'ul', 'li', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]);

export type MailContent = string | { tag: string; children: MailContent[]; href?: string };
export type MailAttachment = { name: string; size: number | null };
export type FormattedMail = { html: string; hasImages: boolean };

export function safeMailUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  const address = value.trim();
  if (address.length > 4096 || !/^https?:\/\//i.test(address) || /[\s\\\u0000-\u001f\u007f]/u.test(address)) return null;
  try {
    const url = new URL(address);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}
