export class LiquidNavigation {
  constructor(menu) {
    this.menu = menu;
    this.window = menu.ownerDocument.defaultView;
    this.motion = this.window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.glass = menu.ownerDocument.createElement('span');
    this.glass.className = 'nav-liquid-glass';
    this.glass.setAttribute('aria-hidden', 'true');
    this.glass.hidden = true;
    menu.append(this.glass);
    this.resize = () => { if (this.selected) this.select(this.selected, false); };
    if (this.window.ResizeObserver) {
      this.observer = new this.window.ResizeObserver(this.resize);
      this.observer.observe(menu);
    } else this.window.addEventListener('resize', this.resize);
    this.motion?.addEventListener('change', this.resize);
  }

  select(button, animate = true) {
    if (!button) return;
    this.selected = button;
    if (this.menu.scrollWidth > this.menu.clientWidth) {
      const menuBounds = this.menu.getBoundingClientRect(), buttonBounds = button.getBoundingClientRect();
      if (buttonBounds.left < menuBounds.left || buttonBounds.right > menuBounds.right) button.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    }
    const bounds = this.menu.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    if (!target.width || !target.height) {
      this.animation?.cancel();
      this.animation = undefined;
      this.glass.hidden = true;
      this.menu.classList.remove('liquid-nav-ready', 'is-flowing');
      return;
    }
    const destination = { x: target.left - bounds.left + this.menu.scrollLeft, y: target.top - bounds.top + this.menu.scrollTop, width: target.width, height: target.height };
    const visible = !this.glass.hidden;
    // Read the rendered location before cancelling, so rapid clicks flow from
    // wherever the glass currently is rather than jumping to an old selection.
    const current = this.glass.getBoundingClientRect();
    const origin = { x: current.left - bounds.left + this.menu.scrollLeft, y: current.top - bounds.top + this.menu.scrollTop, width: current.width, height: current.height };
    this.animation?.cancel();
    this.animation = undefined;
    this.menu.classList.remove('is-flowing');
    this.glass.hidden = false;
    this.menu.classList.add('liquid-nav-ready');
    this.glass.style.width = destination.width + 'px';
    this.glass.style.height = destination.height + 'px';
    this.glass.style.transform = `translate3d(${destination.x}px,${destination.y}px,0)`;
    const dx = destination.x - origin.x, dy = destination.y - origin.y;
    if (!animate || !visible || this.motion?.matches || !this.glass.animate || Math.hypot(dx, dy) < 1) return;
    this.menu.classList.add('is-flowing');
    // A single transform curve avoids layout work, staged speed changes, and
    // overshoot. Scaling only preserves the rendered size on an interrupted move.
    const animation = this.glass.animate([
      { transform: `translate3d(${origin.x}px,${origin.y}px,0) scale(${origin.width / destination.width},${origin.height / destination.height})` },
      { transform: this.glass.style.transform },
    ], { duration: Math.round(280 + Math.min(80, Math.hypot(dx, dy) * .28)), easing: 'cubic-bezier(.2,.75,.25,1)' });
    this.animation = animation;
    animation.onfinish = () => {
      if (this.animation !== animation) return;
      this.animation = undefined;
      this.menu.classList.remove('is-flowing');
    };
  }

  destroy() {
    this.animation?.cancel();
    this.observer?.disconnect();
    this.window.removeEventListener('resize', this.resize);
    this.motion?.removeEventListener('change', this.resize);
    this.menu.classList.remove('liquid-nav-ready', 'is-flowing');
    this.glass.remove();
  }
}

// Keep the same assistant trigger and dialog across layout changes.
export function setupMobileWorkspace(assistant, notifications, dock) {
  const document = assistant.ownerDocument;
  const window = document.defaultView;
  const desktopParent = assistant.parentElement;
  const mobile = window.matchMedia?.('(max-width: 760px)');
  const viewport = window.visualViewport;
  const root = document.documentElement;

  const reserveDockSpace = () => {
    const height = mobile?.matches ? Math.ceil(dock.getBoundingClientRect().height) : 0;
    if (height) root.style.setProperty('--owner-mobile-dock-measured', height + 'px');
    else root.style.removeProperty('--owner-mobile-dock-measured');
  };

  const updateKeyboard = () => {
    const editing = document.activeElement?.matches(
      'textarea, input:is([type="text"], [type="search"], [type="email"], [type="tel"], [type="number"], [type="url"]), input:not([type]), [contenteditable="true"]'
    );
    const keyboardOpen = mobile?.matches && editing && viewport &&
      viewport.scale <= 1.05 && window.innerHeight - viewport.height > 130;
    root.toggleAttribute('data-owner-keyboard', Boolean(keyboardOpen));
  };

  const updateLayout = () => {
    const parent = mobile?.matches ? notifications.parentElement : desktopParent;
    if (assistant.parentElement !== parent) {
      const focused = document.activeElement === assistant;
      if (mobile?.matches) notifications.before(assistant);
      else desktopParent.prepend(assistant);
      if (focused) assistant.focus({ preventScroll: true });
    }
    reserveDockSpace();
    updateKeyboard();
  };

  if (window.ResizeObserver) new window.ResizeObserver(reserveDockSpace).observe(dock);
  else window.addEventListener('resize', reserveDockSpace);
  mobile?.addEventListener?.('change', updateLayout);
  viewport?.addEventListener('resize', updateKeyboard);
  document.addEventListener('focusin', updateKeyboard);
  document.addEventListener('focusout', () => queueMicrotask(updateKeyboard));
  updateLayout();
}
