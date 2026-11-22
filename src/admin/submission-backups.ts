type BackupCopy = { id: string; createdAt: string; quotes: number; reviews: number };
type BackupStatus = { enabled: boolean; copies: BackupCopy[] };
type BackupApi = {
  status: () => Promise<BackupStatus>;
  capture: () => Promise<BackupCopy>;
  restore: (id: string) => Promise<{ restored: number }>;
};

export class SubmissionBackupsPanel {
  private readonly api: BackupApi;
  private readonly refreshWorkspace: () => Promise<void>;
  private readonly status: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly copies: HTMLSelectElement;
  private readonly create: HTMLButtonElement;
  private readonly restore: HTMLButtonElement;
  private readonly download: HTMLAnchorElement;
  private enabled = false;
  private busy = false;

  constructor(root: HTMLElement, api: BackupApi, refreshWorkspace: () => Promise<void>) {
    this.api = api;
    this.refreshWorkspace = refreshWorkspace;
    this.status = root.querySelector<HTMLElement>('#submission-backup-status')!;
    this.controls = root.querySelector<HTMLElement>('#submission-backup-controls')!;
    this.copies = root.querySelector<HTMLSelectElement>('#submission-backup-copy')!;
    this.create = root.querySelector<HTMLButtonElement>('#submission-backup-create')!;
    this.restore = root.querySelector<HTMLButtonElement>('#submission-backup-restore')!;
    this.download = root.querySelector<HTMLAnchorElement>('#submission-backup-download')!;
    this.copies.addEventListener('change', () => this.updateActions());
    this.create.addEventListener('click', () => void this.run('Creating encrypted copy…', async () => {
      const copy = await this.api.capture();
      this.render(await this.api.status(), copy.id);
      this.status.textContent = 'Encrypted copy saved.';
    }));
    this.restore.addEventListener('click', () => {
      const id = this.copies.value;
      if (id) void this.run('Checking for missing submissions…', async () => {
        const { restored } = await this.api.restore(id);
        this.status.textContent = restored ? restored + (restored === 1 ? ' submission restored.' : ' submissions restored.') :
          'Every submission in this copy is already available.';
        if (restored) {
          try { await this.refreshWorkspace(); }
          catch { this.status.textContent += ' Refresh the workspace to see the restored records.'; }
        }
      });
    });
  }

  load() {
    return this.run('Checking backups…', async () => this.render(await this.api.status()));
  }

  private render(result: BackupStatus, selected = this.copies.value) {
    this.enabled = result.enabled;
    const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    this.copies.replaceChildren(...result.copies.map(copy => {
      const option = this.copies.ownerDocument.createElement('option');
      option.value = copy.id;
      option.textContent = date.format(new Date(copy.createdAt)) + ' · ' + copy.quotes + ' quotes · ' + copy.reviews + ' reviews';
      return option;
    }));
    if (result.copies.some(copy => copy.id === selected)) this.copies.value = selected;
    this.controls.hidden = !result.copies.length;
    this.status.textContent = !result.enabled ? 'Set the server backup encryption key to enable saving and recovery.' :
      result.copies.length ? 'Restore adds missing records to the workspace.' : 'Create the first encrypted copy to enable restore.';
    this.updateActions();
  }

  private updateActions() {
    this.create.disabled = this.busy || !this.enabled;
    this.restore.disabled = this.busy || !this.enabled || !this.copies.value;
    this.copies.disabled = this.busy;
    if (!this.busy && this.copies.value) {
      this.download.href = '/.netlify/functions/owner?' + new URLSearchParams({ action: 'backup-download', id: this.copies.value });
    } else this.download.removeAttribute('href');
  }

  private async run(status: string, task: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.status.textContent = status;
    this.updateActions();
    try { await task(); }
    catch (error) { this.status.textContent = error instanceof Error ? error.message : 'The backup action could not be completed.'; }
    finally { this.busy = false; this.updateActions(); }
  }
}
