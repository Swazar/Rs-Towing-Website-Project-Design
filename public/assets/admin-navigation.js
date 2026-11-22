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
    if (!target.width || !target.height) return;
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
