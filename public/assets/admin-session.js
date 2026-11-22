const warningMs = 2 * 60_000;
const touchInterval = 60_000;

export class WorkspaceIdle {
  constructor({ dialog, touch, check, end }) {
    this.dialog = dialog;
    this.document = dialog.ownerDocument;
    this.touch = touch;
    this.check = check;
    this.end = end;
    this.keep = dialog.querySelector('[data-keep-session]');
    this.keep.addEventListener('click', () => this.activity(true));
    dialog.addEventListener('cancel', () => { this.dismissedDeadline = this.deadline; });
    for (const name of ['pointerdown', 'keydown', 'input', 'wheel']) {
      this.document.addEventListener(name, () => this.activity(), { passive: true });
    }
    this.document.addEventListener('visibilitychange', () => {
      if (!this.document.hidden) this.update();
    });
    this.document.defaultView.addEventListener('pageshow', () => this.update());
  }

  start(deadline) {
    this.stop();
    if (!Number.isFinite(deadline)) return;
    this.deadline = deadline;
    this.lastTouch = Date.now();
    this.update();
  }

  stop() {
    this.deadline = null;
    this.pending = null;
    clearTimeout(this.timer);
    if (this.dialog.open) this.dialog.close();
  }

  async activity(force = false) {
    if (!this.deadline || this.pending || this.document.hidden) return;
    if (this.deadline <= Date.now()) { this.update(); return; }
    if (!force && (this.dialog.open || Date.now() - this.lastTouch < touchInterval)) return;
    this.lastTouch = Date.now();
    const pending = this.touch();
    this.pending = pending;
    try {
      const result = await pending;
      if (this.pending !== pending) return;
      if (force && result.expiresAt === this.deadline) this.dismissedDeadline = this.deadline;
      this.start(result.expiresAt);
    } catch {
      // The protected API handles a confirmed sign-out. A network hiccup leaves
      // the existing deadline in place so the user can retry.
      if (this.pending === pending && this.dialog.open) this.dialog.querySelector('[role=status]').textContent = 'Could not extend the session. Try again.';
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  async update() {
    clearTimeout(this.timer);
    if (!this.deadline) return;
    const left = this.deadline - Date.now();
    if (left <= 0) {
      if (this.checking) return;
      this.checking = true;
      const deadline = this.deadline;
      try {
        const result = await this.check();
        if (this.deadline !== deadline) return;
        if (result.expiresAt > Date.now()) this.start(result.expiresAt);
        else this.end();
      } catch {
        if (this.deadline === deadline) this.end();
      } finally { this.checking = false; }
      return;
    }
    if (left <= warningMs && !this.dialog.open && !this.document.hidden && this.dismissedDeadline !== this.deadline) {
      this.dialog.querySelector('[role=status]').textContent = '';
      this.dialog.showModal();
    }
    this.timer = setTimeout(() => this.update(), left <= warningMs ? left : left - warningMs);
  }
}
