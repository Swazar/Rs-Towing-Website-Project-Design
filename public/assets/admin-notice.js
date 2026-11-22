export class WorkspaceNotice {
  constructor(element) {
    this.element = element;
    this.copy = element.querySelector('#owner-message');
    this.title = element.querySelector('#owner-message-title');
    this.detail = element.querySelector('#owner-message-detail');
    this.icon = element.querySelector('#owner-message-icon');
    this.window = element.ownerDocument.defaultView;
    this.document = element.ownerDocument;
    element.querySelector('#owner-message-dismiss').addEventListener('click', () => this.hide());
    element.addEventListener('mouseenter', () => { this.hovered = true; this.pause(); });
    element.addEventListener('mouseleave', () => { this.hovered = false; this.resume(); });
    element.addEventListener('focusin', () => this.pause());
    element.addEventListener('focusout', () => queueMicrotask(() => this.resume()));
    element.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.hide(); } });
    this.document.addEventListener('visibilitychange', () => this.document.hidden ? this.pause() : this.resume());
  }
  show(text, { tone = 'success', detail = '', persist = false } = {}) {
    this.pause();
    if (!text) { this.hide(); return; }
    if (!this.element.contains(this.document.activeElement)) this.returnFocus = this.document.activeElement;
    this.element.dataset.tone = tone;
    this.copy.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    this.copy.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    this.title.textContent = tone === 'error' ? 'Something needs attention' : text;
    this.detail.textContent = tone === 'error' ? text : detail;
    this.detail.hidden = !this.detail.textContent;
    this.icon.setAttribute('href', '/assets/admin-icons.svg#' + (tone === 'error' ? 'circle-alert' : tone === 'info' ? 'info' : 'check'));
    this.remaining = tone === 'error' || persist ? 0 : 8000;
    this.element.hidden = false;
    this.resume();
  }
  pause() {
    if (this.timer === undefined) return;
    this.window.clearTimeout(this.timer);
    this.remaining = Math.max(0, this.remaining - (this.window.performance.now() - this.started));
    this.timer = undefined;
  }
  resume() {
    if (this.timer !== undefined || !this.remaining || this.element.hidden || this.document.hidden || this.hovered || this.element.contains(this.document.activeElement)) return;
    this.started = this.window.performance.now();
    this.timer = this.window.setTimeout(() => this.hide(), this.remaining);
  }
  hide() {
    this.pause(); this.remaining = 0;
    const restoreFocus = this.element.contains(this.document.activeElement);
    this.element.hidden = true;
    this.title.textContent = ''; this.detail.textContent = '';
    if (restoreFocus && this.returnFocus?.isConnected && !this.returnFocus.disabled && !this.returnFocus.closest('[hidden],dialog:not([open])')) this.returnFocus.focus();
  }
}
