import { mailAddress, mailLimits, type ComposerDraft, type DraftFields, type MailFile, type MailReply, type OutgoingMail, type SavedMailDraft, type SentMail } from '../domain/mail/compose.ts';

export type ReplyDraft = { recipient: string; subject: string; reply: MailReply };

const fields = ['to', 'cc', 'bcc', 'subject', 'text'] as const;
type Field = typeof fields[number];
type DraftStore = {
  load: (mailbox: string) => Promise<SavedMailDraft>;
  save: (mailbox: string, revision: string | null, draft: ComposerDraft | null) => Promise<{ revision: string | null }>;
};
const fileSize = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 1 });
const addresses = (text: string) => text.split(/[,;]/).map(value => value.trim()).filter(Boolean);

function attachment(file: File, window: Window & typeof globalThis): Promise<MailFile> {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.addEventListener('load', () => {
      const encoded = typeof reader.result === 'string' ? reader.result.split(',')[1] : '';
      if (encoded) resolve({ name: file.name, data: encoded });
      else reject(new Error('An attachment could not be read.'));
    });
    reader.addEventListener('error', () => reject(new Error('An attachment could not be read.')));
    reader.readAsDataURL(file);
  });
}

export class GmailComposer {
  private readonly dialog: HTMLDialogElement;
  private readonly form: HTMLFormElement;
  private readonly fieldset: HTMLFieldSetElement;
  private readonly input: Record<Field, HTMLInputElement | HTMLTextAreaElement>;
  private readonly title: HTMLElement;
  private readonly from: HTMLElement;
  private readonly copy: HTMLButtonElement;
  private readonly copyFields: HTMLElement;
  private readonly close: HTMLButtonElement;
  private readonly discard: HTMLButtonElement;
  private readonly send: HTMLButtonElement;
  private readonly attach: HTMLButtonElement;
  private readonly file: HTMLInputElement;
  private readonly files: HTMLElement;
  private readonly status: HTMLElement;
  private readonly draftStatus: HTMLElement;
  private readonly save: HTMLButtonElement;
  private readonly window: Window & typeof globalThis;
  private readonly drafts: DraftStore;
  private readonly deliver: (mail: OutgoingMail) => Promise<SentMail>;
  private readonly onSent: (result: SentMail, reply?: MailReply) => void;
  private readonly onAuthError: (code: string) => void;
  private account = '';
  private enabled = false;
  private editing = false;
  private busy = false;
  private version = 0;
  private reply?: MailReply;
  private pending?: OutgoingMail;
  private attachments: File[] = [];
  private readonly packed = new WeakMap<File, Promise<MailFile>>();
  private mailbox = '';
  private savedRevision: string | null | undefined;
  private editCount = 0;
  private savedCount = 0;
  private autosave?: number;
  private saving?: Promise<boolean>;
  private loading = false;

  constructor(root: HTMLElement, deliver: (mail: OutgoingMail) => Promise<SentMail>,
    onSent: (result: SentMail, reply?: MailReply) => void, onAuthError: (code: string) => void, drafts: DraftStore) {
    const get = <T extends HTMLElement>(name: string) => root.querySelector<T>('#gmail-compose-' + name)!;
    this.deliver = deliver;
    this.onSent = onSent;
    this.onAuthError = onAuthError;
    this.drafts = drafts;
    this.window = root.ownerDocument.defaultView!;
    this.dialog = get('dialog');
    this.form = get('form');
    this.fieldset = get('fields');
    this.title = get('title');
    this.from = get('from');
    this.copy = get('copy');
    this.copyFields = get('copy-fields');
    this.close = get('close');
    this.discard = get('discard');
    this.send = get('send');
    this.attach = get('attach');
    this.file = get('file');
    this.files = get('attachments');
    this.status = get('status');
    this.draftStatus = get('draft-status');
    this.save = get('save-draft');
    this.input = { to: get('to'), cc: get('cc'), bcc: get('bcc'), subject: get('subject'), text: get('text') };
    this.copy.addEventListener('click', () => this.showCopy(this.copyFields.hidden));
    this.close.addEventListener('click', () => this.dismiss());
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.dismiss(); });
    this.discard.addEventListener('click', () => void this.discardDraft());
    this.save.addEventListener('click', () => void this.persist());
    this.form.addEventListener('input', event => {
      if (fields.some(field => event.target === this.input[field])) this.changed();
    });
    this.attach.addEventListener('click', () => this.file.click());
    this.file.addEventListener('change', () => {
      this.addFiles([...this.file.files ?? []]);
      this.file.value = '';
    });
    this.form.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (['to', 'cc', 'bcc', 'subject'] as const).some(field => event.target === this.input[field])) {
        event.preventDefault();
      }
    });
    this.form.addEventListener('submit', event => { event.preventDefault(); void this.submit(); });
    this.window.addEventListener('beforeunload', event => {
      if (this.editCount === this.savedCount && !this.saving && !this.busy) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  setAccount(account = '', enabled = false, mailbox = '') {
    if (account !== this.account || mailbox !== this.mailbox) this.reset();
    this.account = account;
    this.mailbox = mailbox;
    this.from.textContent = account;
    this.enabled = enabled;
    this.updateControls();
  }

  async open(reply?: ReplyDraft) {
    if (!this.enabled || this.dialog.open) return;
    this.dialog.showModal();
    const version = this.version;
    if (this.mailbox && this.savedRevision === undefined && !this.editing) {
      this.loading = true;
      this.draftStatus.textContent = 'Checking for a saved draft…';
      this.updateControls();
      try {
        const saved = await this.drafts.load(this.mailbox);
        if (version !== this.version) return;
        this.savedRevision = saved.revision;
        if (saved.data) this.restoreDraft(saved.data);
        else this.draftStatus.textContent = '';
      } catch {
        if (version !== this.version) return;
        this.draftStatus.textContent = 'Draft recovery is unavailable. Save before leaving this page.';
      } finally {
        if (version === this.version) {
          this.loading = false;
          this.updateControls();
        }
      }
    }
    if (!this.editing) {
      this.editing = true;
      this.reply = reply?.reply;
      this.title.textContent = reply ? 'Reply' : 'New message';
      this.input.to.value = reply?.recipient ?? '';
      this.input.subject.value = reply?.subject ?? '';
      this.input.subject.readOnly = Boolean(reply);
      if (reply && this.mailbox) this.changed();
    } else if (reply && this.reply?.messageId !== reply.reply.messageId) {
      this.status.textContent = 'Finish or discard this draft before replying to another message.';
    }
    (this.pending ? this.send : this.input.to.value ? this.input.text : this.input.to).focus();
  }

  dismiss() {
    if (this.busy || this.loading || !this.dialog.open) return;
    if (this.editCount !== this.savedCount && this.mailbox) void this.persist();
    this.dialog.close();
    if (!this.pending && this.editCount === this.savedCount && !this.hasContent()) this.reset();
  }

  reset() {
    this.version++;
    this.window.clearTimeout(this.autosave);
    this.busy = this.editing = false;
    this.loading = false;
    this.saving = undefined;
    this.savedRevision = undefined;
    this.editCount = this.savedCount = 0;
    this.pending = this.reply = undefined;
    this.attachments = [];
    this.form.reset();
    this.status.textContent = '';
    this.draftStatus.textContent = '';
    this.showCopy(false);
    this.renderAttachments();
    if (this.dialog.open) this.dialog.close();
    this.updateControls();
  }

  private showCopy(show: boolean) {
    this.copyFields.hidden = !show;
    this.copy.setAttribute('aria-expanded', String(show));
    if (show && this.dialog.open) this.input.cc.focus();
  }

  private updateControls() {
    this.fieldset.disabled = this.busy || this.loading || Boolean(this.pending);
    this.attach.disabled = this.fieldset.disabled;
    this.close.disabled = this.busy || this.loading;
    this.discard.disabled = this.busy || this.loading || Boolean(this.saving);
    this.save.hidden = !this.mailbox;
    this.save.disabled = this.busy || this.loading || Boolean(this.saving) || Boolean(this.pending);
    this.send.disabled = this.busy || this.loading || !this.enabled;
    this.send.textContent = this.busy ? 'Sending…' : this.pending ? 'Retry safely' : 'Send';
  }

  private addFiles(files: File[]) {
    if (this.busy || this.pending) return;
    const next = [...this.attachments, ...files];
    if (next.length > mailLimits.attachments) this.status.textContent = 'Attach up to 10 files.';
    else if (next.some(file => !file.size)) this.status.textContent = 'Choose a file that is not empty.';
    else if (next.reduce((total, file) => total + file.size, 0) > mailLimits.attachmentBytes) this.status.textContent = 'Attachments must be 3 MB total or smaller.';
    else {
      this.attachments = next;
      this.status.textContent = '';
      this.renderAttachments();
      this.changed();
    }
  }

  private renderAttachments() {
    const document = this.files.ownerDocument;
    this.files.replaceChildren(...this.attachments.map((file, index) => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = file.name;
      const size = document.createElement('small');
      size.textContent = fileSize.format(file.size / 1000);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + file.name);
      remove.addEventListener('click', () => {
        this.attachments.splice(index, 1);
        this.renderAttachments();
        this.changed();
        (this.files.querySelectorAll<HTMLButtonElement>('button')[index] ?? this.attach).focus();
      });
      row.append(name, size, remove);
      return row;
    }));
    this.files.hidden = this.attachments.length === 0;
  }

  private hasContent() {
    return this.attachments.length || fields.some(field => Boolean(this.input[field].value.trim()));
  }

  private changed() {
    this.editCount++;
    if (!this.mailbox) return;
    this.draftStatus.textContent = 'Draft has unsaved changes.';
    this.window.clearTimeout(this.autosave);
    this.autosave = this.window.setTimeout(() => { if (!this.busy) void this.persist(); }, 1600);
  }

  private encodeAttachments() {
    return Promise.all(this.attachments.map(file => {
      let packed = this.packed.get(file);
      if (!packed) {
        packed = attachment(file, this.window);
        this.packed.set(file, packed);
        void packed.catch(() => this.packed.delete(file));
      }
      return packed;
    }));
  }

  private restoreDraft(draft: ComposerDraft) {
    this.editing = true;
    this.reply = draft.reply;
    this.title.textContent = draft.reply ? 'Reply' : 'New message';
    this.input.subject.readOnly = Boolean(draft.reply);
    for (const field of fields) this.input[field].value = draft[field];
    this.showCopy(Boolean(draft.cc || draft.bcc));
    this.attachments = draft.attachments.map(saved => {
      const bytes = Uint8Array.from(this.window.atob(saved.data), char => char.charCodeAt(0));
      const file = new this.window.File([bytes], saved.name);
      this.packed.set(file, Promise.resolve(saved));
      return file;
    });
    this.renderAttachments();
    this.draftStatus.textContent = 'Saved draft restored.';
    if (draft.attempt) {
      this.pending = { ...this.messageValues(), attachments: draft.attachments, requestId: draft.attempt.id, mailbox: this.mailbox };
      this.status.textContent = 'Check Gmail Sent before retrying this delivery attempt.';
    }
  }

  private async persist(attempt?: ComposerDraft['attempt'], discard = false) {
    if (!this.mailbox) return true;
    const version = this.version;
    while (this.saving) await this.saving;
    if (version !== this.version) return false;
    if (!attempt && !discard && this.pending) return true;
    if (!attempt && !discard && this.editCount === this.savedCount && this.savedRevision !== undefined) return true;
    const mailbox = this.mailbox;
    const editCount = this.editCount;
    const fieldsToSave = Object.fromEntries(fields.map(field => [field, this.input[field].value])) as DraftFields;
    const reply = this.reply;
    const hasContent = this.hasContent();
    const operation = async () => {
      try {
        this.draftStatus.textContent = 'Saving draft…';
        if (this.savedRevision === undefined) {
          const prior = await this.drafts.load(mailbox);
          if (version !== this.version) return false;
          if (prior.data) throw new Error('A saved draft already exists. Keep this tab open to copy your edits before reloading.');
          this.savedRevision = prior.revision;
        }
        const draft = !discard && (hasContent || attempt) ? {
          ...fieldsToSave, attachments: await this.encodeAttachments(), ...(reply ? { reply } : {}), ...(attempt ? { attempt } : {}),
        } : null;
        if (version !== this.version) return false;
        const saved = await this.drafts.save(mailbox, this.savedRevision, draft);
        if (version !== this.version) return false;
        this.savedRevision = saved.revision;
        this.savedCount = editCount;
        this.draftStatus.textContent = this.editCount !== editCount ? 'Draft has unsaved changes.' : draft ? 'Draft saved.' : '';
        return true;
      } catch (error) {
        if (version === this.version) {
          const conflict = error instanceof Error && 'code' in error && error.code === 'gmail-draft-conflict';
          this.draftStatus.textContent = conflict ? error.message : 'Draft could not be saved. Keep this tab open and try again.';
        }
        return false;
      }
    };
    this.saving = operation();
    this.updateControls();
    try { return await this.saving; }
    finally {
      if (version === this.version) {
        this.saving = undefined;
        this.updateControls();
      }
    }
  }

  private async discardDraft() {
    if (await this.persist(undefined, true)) this.reset();
  }

  private messageValues() {
    return {
      to: addresses(this.input.to.value), cc: addresses(this.input.cc.value), bcc: addresses(this.input.bcc.value),
      subject: this.input.subject.value.trim(), text: this.input.text.value, ...(this.reply ? { reply: this.reply } : {}),
    };
  }

  private validate() {
    const values = this.messageValues();
    const all = [...values.to, ...values.cc, ...values.bcc];
    if (!all.length || all.length > mailLimits.recipients) {
      this.status.textContent = 'Add between 1 and 20 recipients.';
      this.input.to.focus();
      return;
    }
    for (const field of ['to', 'cc', 'bcc'] as const) {
      if (values[field].every(mailAddress)) continue;
      if (field !== 'to') this.showCopy(true);
      this.status.textContent = 'Enter complete email addresses separated by commas.';
      this.input[field].focus();
      return;
    }
    if (new Set(all.map(address => address.toLowerCase())).size !== all.length) {
      this.status.textContent = 'Add each recipient only once.';
      this.input.to.focus();
      return;
    }
    if (!this.input.text.value.trim() && !this.attachments.length) {
      this.status.textContent = 'Write a message or attach a file.';
      this.input.text.focus();
      return;
    }
    return values;
  }

  private async submit() {
    if (!this.dialog.open || !this.enabled || this.busy || this.loading) return;
    const values = this.pending ?? this.validate();
    if (!values) return;
    const version = this.version;
    this.busy = true;
    this.status.textContent = '';
    this.updateControls();
    let outgoing = this.pending;
    try {
      if (!outgoing) {
        const attachments = await this.encodeAttachments();
        outgoing = { ...values, requestId: this.window.crypto.randomUUID(), attachments, ...(this.mailbox ? { mailbox: this.mailbox } : {}) };
      }
      if (version !== this.version) return;
      if (this.mailbox && !this.pending && !await this.persist({ id: outgoing.requestId, at: Date.now() })) return;
      if (version !== this.version) return;
      const result = await this.deliver(outgoing);
      if (version !== this.version) return;
      const reply = this.reply;
      this.reset();
      this.onSent(result, reply);
    } catch (error) {
      if (version !== this.version) return;
      const failure = error as Error & { status?: number; code?: string };
      if (outgoing && (!failure.status || failure.status >= 500 || failure.code === 'gmail-send-unknown')) {
        this.pending = outgoing;
        this.status.textContent = 'Delivery could not be confirmed. Check Gmail Sent before retrying.';
      } else {
        this.pending = undefined;
        this.status.textContent = failure.message || 'The message could not be sent.';
        if (outgoing && this.mailbox) {
          this.editCount++;
          await this.persist();
        }
      }
      if (failure.code === 'gmail-reconnect' || failure.code === 'gmail-send-access') this.onAuthError(failure.code);
    } finally {
      if (version === this.version) {
        this.busy = false;
        this.updateControls();
      }
    }
  }
}
