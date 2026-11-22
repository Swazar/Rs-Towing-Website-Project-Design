import { effectiveWorkspace, mobileWorkspaceQuery, workspacePanels, workspacePresets, availablePanels } from './workspace-config.js';

export class WorkspaceLayout {
  constructor(document, onCustomize) {
    this.document = document;
    this.mobile = document.defaultView.matchMedia?.(mobileWorkspaceQuery);
    this.mobile?.addEventListener('change', () => { if (this.active) this.apply(this.lastValue, this.lastPermissions); });
    this.grid = document.querySelector('.overview-grid');
    this.panels = new Map(workspacePanels.map(panel => [panel.id, document.querySelector(panel.selector)]));
    // Keep real DOM order and visual order identical, including on mobile.
    for (const [id, element] of this.panels) {
      if (!element) continue;
      element.dataset.workspacePanel = id;
      this.grid.append(element);
    }
    this.grid.querySelectorAll('.overview-column').forEach(column => column.remove());
    this.empty = document.createElement('div'); this.empty.className = 'workspace-empty workspace-panel';
    const title = document.createElement('h2'); title.textContent = 'Make room for what matters';
    const copy = document.createElement('p'); copy.textContent = 'Your overview panels are hidden. Add them back whenever you like.';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-outline'; button.textContent = 'Customize overview'; button.addEventListener('click', onCustomize);
    this.empty.append(title, copy, button); this.empty.hidden = true; this.grid.after(this.empty);
  }
  apply(value, permissions = []) {
    this.lastValue = value; this.lastPermissions = permissions; this.active = true;
    const settings = effectiveWorkspace(value, this.mobile?.matches), preset = workspacePresets.find(item => item.id === settings.preset);
    const root = this.document.documentElement;
    root.classList.add('workspace-customized');
    root.style.setProperty('--workspace-font-scale', settings.fontSize / 100);
    this.document.body.dataset.workspaceDensity = preset.id;
    this.document.body.dataset.workspaceTheme = settings.theme;
    this.grid.dataset.layout = settings.layout;
    this.document.body.style.setProperty('--workspace-gap', preset.gap + 'px');
    this.document.body.style.setProperty('--workspace-padding', preset.padding + 'px');
    const permitted = new Set(availablePanels(permissions).map(panel => panel.id));
    let visible = 0;
    for (const id of settings.panelOrder) {
      const element = this.panels.get(id);
      if (!element) continue;
      element.hidden = !permitted.has(id) || settings.hiddenPanels.includes(id);
      this.grid.append(element);
      if (!element.hidden) visible++;
    }
    this.empty.hidden = visible > 0;
    this.grid.hidden = visible === 0;
  }
  clear() { this.active = false; this.document.documentElement.classList.remove('workspace-customized'); }
}
