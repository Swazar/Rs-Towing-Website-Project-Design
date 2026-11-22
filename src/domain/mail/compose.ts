export const mailLimits = {
  attachmentBytes: 3_000_000,
  attachments: 10,
  recipients: 20,
  subject: 300,
  text: 60_000,
} as const;

export type MailFile = { name: string; data: string };
export type MailReply = { threadId: string; messageId: string };
export type OutgoingMail = {
  requestId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  attachments: MailFile[];
  reply?: MailReply;
  mailbox?: string;
};
export type SentMail = { id: string; threadId: string };
export type DraftFields = { to: string; cc: string; bcc: string; subject: string; text: string };
export type ComposerDraft = DraftFields & {
  attachments: MailFile[];
  reply?: MailReply;
  attempt?: { id: string; at: number };
};
export type SavedMailDraft = { data: ComposerDraft | null; revision: string | null };

export function mailAddress(value: string) {
  const [local, domain, extra] = value.split('@');
  return value.length <= 254 && extra === undefined && local.length <= 64 &&
    /^[a-z\d!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z\d!#$%&'*+\/=?^_`{|}~-]+)*$/i.test(local) &&
    /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(domain ?? '');
}
