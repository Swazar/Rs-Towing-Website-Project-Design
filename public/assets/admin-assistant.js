import { node } from './admin-ui.js';

export class WorkspaceAssistant {
  constructor({ onExpired }) {
    const byId = id => document.getElementById(id);
    this.onExpired = onExpired;
    this.dialog = byId('workspace-assistant');
    this.launcher = byId('assistant-open');
    this.title = byId('assistant-title');
    this.thread = byId('assistant-thread');
    this.form = byId('assistant-form');
    this.question = byId('assistant-question');
    this.send = byId('assistant-send');
    this.status = byId('assistant-status');
    this.bars = { settings: document.querySelector('.settings-save-bar'), website: document.querySelector('.owner-publish') };
    this.turns = [];

    this.launcher.addEventListener('click', () => {
      if (this.launcher.hidden || this.dialog.open) return;
      this.dialog.showModal();
      this.title.focus();
    });
    byId('assistant-close').addEventListener('click', () => this.dialog.close());
    byId('assistant-reset').addEventListener('click', () => {
      this.clear();
      this.question.focus();
    });
    this.dialog.addEventListener('close', () => {
      if (!this.launcher.closest('[hidden]')) this.launcher.focus({ preventScroll: true });
    });
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      this.ask(this.question.value.trim());
    });
    const resize = () => this.setView(this.view);
    const win = document.defaultView;
    if (win.ResizeObserver) {
      this.observer = new win.ResizeObserver(resize);
      Object.values(this.bars).filter(Boolean).forEach(bar => this.observer.observe(bar));
    }
    win.addEventListener('resize', resize, { passive: true });
  }

  setAvailable(available) {
    this.launcher.hidden = !available;
    if (!available) {
      this.clear();
      if (this.dialog.open) this.dialog.close();
    }
  }

  setView(view) {
    this.view = view;
    const bar = this.bars[view];
    const sticky = bar && document.defaultView.getComputedStyle(bar).position === 'sticky';
    const reserve = sticky ? Math.ceil(bar.getBoundingClientRect().height) + 18 : 0;
    this.launcher.style.setProperty('--assistant-dock', reserve + 'px');
  }

  clear() {
    this.request?.abort();
    this.request = null;
    this.turns = [];
    this.form.reset();
    this.thread.querySelectorAll('.assistant-message').forEach(message => message.remove());
    this.status.textContent = '';
    this.setBusy(false);
  }

  setBusy(busy) {
    this.send.toggleAttribute('data-busy', busy);
    this.send.setAttribute('aria-disabled', String(busy));
  }

  append(label, text, fromUser = false) {
    const message = node('article', undefined, fromUser ? 'assistant-message is-user' : 'assistant-message');
    message.append(node('strong', label), node('p', text));
    this.thread.append(message);
    this.thread.scrollTop = this.thread.scrollHeight;
    return message;
  }

  trimThread() {
    const messages = this.thread.querySelectorAll('.assistant-message');
    [...messages].slice(0, Math.max(0, messages.length - 24)).forEach(entry => entry.remove());
  }

  async ask(question) {
    if (!question || this.request || this.launcher.hidden) return;
    const controller = new AbortController();
    this.request = controller;
    const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), 12_000);
    this.setBusy(true);
    this.status.textContent = 'Waiting for a reply…';
    this.question.value = '';
    const pendingMessage = this.append('You', question, true);
    try {
      const response = await fetch('/.netlify/functions/workspace-assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, turns: this.turns }),
        signal: controller.signal,
      });
      if (this.request !== controller) return;
      if (response.status === 401) {
        this.onExpired();
        return;
      }
      if (response.status === 404) {
        this.setAvailable(false);
        return;
      }
      const reply = await response.json().catch(() => ({}));
      if (this.request !== controller) return;
      if (!response.ok || !reply.answer) throw new Error(reply.error || 'The assistant couldn’t reply. Try again in a moment.');
      this.append('Assistant', reply.answer);
      this.trimThread();
      this.turns = [...this.turns, { question, answer: reply.answer }].slice(-3);
      this.status.textContent = '';
    } catch (error) {
      if (this.request !== controller) return;
      pendingMessage.remove();
      if (!this.question.value) this.question.value = question;
      this.status.textContent = error.name === 'TimeoutError' ? 'The assistant took too long. Try again.' : error.message;
    } finally {
      clearTimeout(timeout);
      if (this.request === controller) {
        this.request = null;
        this.setBusy(false);
      }
    }
  }
}
