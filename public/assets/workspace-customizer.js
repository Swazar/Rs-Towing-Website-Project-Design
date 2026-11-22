import { workspacePresets, workspaceThemes, mobileWorkspaceQuery, effectiveWorkspace, workspaceDefaults, resolveWorkspace, availablePanels } from './workspace-config.js';

export class WorkspaceCustomizer {
  constructor(container, onChange) {
    this.container = container; this.document = container.ownerDocument; this.onChange = onChange;
    this.value = workspaceDefaults(); this.permissions = [];
    this.mobile = this.document.defaultView.matchMedia?.(mobileWorkspaceQuery);
    this.build();
    this.mobile?.addEventListener('change', () => this.renderPanels());
  }
  node(tag, text, className) {
    const node = this.document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node;
  }
  build() {
    const choices = this.node('fieldset', '', 'workspace-preset-options workspace-desktop-only'); choices.append(this.node('legend', 'Desktop workspace preset'));
    const cards = this.node('div', '', 'workspace-preset-cards');
    workspacePresets.forEach(preset => {
      const label = this.node('label', '', 'workspace-preset-card'); label.dataset.preset = preset.id;
      const radio = this.node('input'); radio.type = 'radio'; radio.name = 'workspacePreset'; radio.value = preset.id;
      const scene = this.node('span', '', 'workspace-preset-scene'); scene.setAttribute('aria-hidden', 'true');
      scene.append(this.node('span', 'Aa', 'preset-type'), this.node('span', 'Workspace', 'preset-heading'));
      const panels = this.node('span', '', 'preset-panels');
      for (let index = 0; index < 4; index++) {
        const panel = this.node('span', '', 'preset-panel'); panel.append(this.node('i'), this.node('i')); panels.append(panel);
      }
      scene.append(panels);
      label.append(radio, scene, this.node('strong', preset.title), this.node('span', preset.description, 'preset-description'));
      radio.addEventListener('change', () => {
        if (radio.checked) { this.value = { ...this.value, preset: preset.id, layout: preset.layout, fontSize: preset.fontSize }; this.refresh(); this.changed(preset.title + ' preset selected.'); }
      });
      cards.append(label);
    });
    choices.append(cards); this.container.append(choices);
    this.container.append(this.node('p', 'Mobile has one consistent layout. Workspace presets and panel order are available on desktop.', 'workspace-mobile-note'));
    this.buildThemes();
    const helpRow = this.node('div', '', 'workspace-help-row');
    helpRow.append(this.node('span', 'Choose the panels you need', 'workspace-control-hint'));
    const help = this.node('button', '?', 'workspace-help-trigger'); help.type = 'button'; help.setAttribute('aria-label', 'How panels and arrangement work'); help.setAttribute('aria-haspopup', 'dialog'); help.setAttribute('aria-controls', 'workspace-panel-help');
    this.buildHelp(help); helpRow.append(help); this.container.append(helpRow);
    const details = this.node('details', '', 'workspace-panel-controls');
    const orderHelp = this.node('p', 'Check panels to show them. On desktop, choose a position: 1 is first, then 2, 3, and so on. Other panels shift automatically. Save changes to apply. Mobile keeps a fixed order.', 'workspace-control-hint'); orderHelp.id = 'workspace-order-help';
    details.append(this.node('summary', 'Panels & arrangement'), orderHelp);
    this.list = this.node('div', '', 'workspace-panel-list'); details.append(this.list); this.container.append(details);
    const footer = this.node('div', '', 'workspace-customizer-footer');
    const reset = this.node('button', 'Restore workspace defaults', 'quiet-button'); reset.type = 'button'; reset.id = 'workspace-reset';
    reset.addEventListener('click', () => { this.value = workspaceDefaults(); this.refresh(); this.changed('Workspace defaults selected.'); });
    this.status = this.node('p', '', 'workspace-control-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    footer.append(reset, this.node('span', 'Save changes to apply your selections.', 'workspace-control-hint')); this.container.append(footer, this.status);
  }
  refreshThemeStyles() {
    this.themeInputs?.forEach(input => { input.checked = input.value === this.value.theme; input.closest('label').classList.toggle('is-selected', input.checked); });
  }
  buildThemes() {
    const host = this.document.querySelector('#workspace-themes'); if (!host) return;
    const group = this.node('fieldset', '', 'workspace-theme-group'); group.append(this.node('legend', 'Workspace color theme'));
    const row = this.node('div', '', 'workspace-theme-options'); this.themeInputs = [];
    workspaceThemes.forEach(theme => {
      const label = this.node('label', '', 'workspace-theme-choice'); label.dataset.theme = theme.id;
      const input = this.node('input'); input.type = 'radio'; input.name = 'workspace-theme'; input.value = theme.id; input.setAttribute('aria-label', theme.title); input.setAttribute('aria-describedby', 'workspace-theme-' + theme.id); this.themeInputs.push(input);
      const preview = this.node('span', '', 'workspace-theme-preview'); preview.setAttribute('aria-hidden', 'true');
      preview.append(this.node('i'), this.node('i'), this.node('i'));
      const description = this.node('span', theme.description); description.id = 'workspace-theme-' + theme.id;
      label.append(input, preview, this.node('strong', theme.title), description); row.append(label);
      input.addEventListener('change', () => { if (input.checked) { this.value.theme = theme.id; this.refreshThemeStyles(); this.changed(theme.title + ' theme selected.'); } });
    });
    group.append(row); host.append(group);
  }
  buildHelp(trigger) {
    const dialog = this.node('dialog', '', 'owner-small-dialog workspace-help-dialog'); dialog.id = 'workspace-panel-help'; dialog.setAttribute('aria-labelledby', 'workspace-panel-help-title');
    const heading = this.node('div', '', 'workspace-help-heading'), title = this.node('h2', 'Make Overview work for you'); title.id = 'workspace-panel-help-title';
    const close = this.node('button', '×', 'icon-button'); close.type = 'button'; close.setAttribute('aria-label', 'Close panel help'); heading.append(title, close); dialog.append(heading);
    dialog.append(this.node('p', 'Each checkbox controls one Overview panel. Hiding a panel keeps its data and tools available elsewhere in the workspace.'));
    const demo = this.node('div', '', 'workspace-help-demo');
    for (const [state, caption] of [['shown', 'Checked · panel shown'], ['hidden', 'Unchecked · panel hidden']]) {
      const example = this.node('div'); example.append(this.node('strong', caption));
      const board = this.node('div', '', 'workspace-help-board ' + state); board.setAttribute('aria-hidden', 'true');
      board.append(this.node('span', 'Requests'), this.node('span', 'Calendar'), this.node('span', 'Map')); example.append(board); demo.append(example);
    }
    dialog.append(demo, this.node('p', 'On desktop, choose a panel’s numbered position. 1 is first. Choosing 3 moves it to third place and shifts the other panels automatically. Unchecked panels keep their place for when you show them again. Mobile always uses one fixed column and order.'), this.node('p', 'Selections take effect after Save changes. Restore workspace defaults selects the original theme, Balanced preset, and all permitted panels; save to apply them.', 'workspace-control-hint'));
    this.document.body.append(dialog);
    trigger.addEventListener('click', () => dialog.showModal()); close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => trigger.focus());
  }
  load(value, permissions) { this.value = resolveWorkspace(value); this.permissions = permissions || []; this.refresh(); this.status.textContent = ''; }
  refresh() {
    this.container.querySelectorAll('[name="workspacePreset"]').forEach(input => { input.checked = input.value === this.value.preset; input.closest('label').classList.toggle('is-selected', input.checked); });
    this.refreshThemeStyles();
    this.renderPanels();
  }
  renderPanels(focus) {
    this.list.replaceChildren();
    const allowed = availablePanels(this.permissions), ordered = effectiveWorkspace(this.value, this.mobile?.matches).panelOrder.filter(id => allowed.some(panel => panel.id === id));
    ordered.forEach((id, index) => {
      const panel = allowed.find(item => item.id === id), row = this.node('div', '', 'workspace-panel-control');
      const label = this.node('label'), input = this.node('input'); input.type = 'checkbox'; input.checked = !this.value.hiddenPanels.includes(id); input.dataset.panel = id;
      input.setAttribute('aria-label', panel.title); input.setAttribute('aria-describedby', 'panel-description-' + id);
      const thumbnail = this.node('span', '', 'workspace-panel-thumbnail'); thumbnail.dataset.kind = id; thumbnail.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < (id === 'calendar' ? 9 : 3); index++) thumbnail.append(this.node('i'));
      const copy = this.node('span', '', 'workspace-panel-copy'), description = this.node('small', panel.description); description.id = 'panel-description-' + id;
      copy.append(this.node('strong', panel.title), description); label.append(input, thumbnail, copy); row.append(label);
      input.addEventListener('change', () => {
        this.value.hiddenPanels = input.checked ? this.value.hiddenPanels.filter(item => item !== id) : [...this.value.hiddenPanels, id];
        this.changed(panel.title + (input.checked ? ' shown.' : ' hidden.'));
      });
      const actions = this.node('div', '', 'workspace-order-actions'), positionLabel = this.node('label', '', 'workspace-position');
      const position = this.node('select'); position.dataset.position = id; position.setAttribute('aria-label', 'Position of ' + panel.title); position.setAttribute('aria-describedby', 'workspace-order-help');
      ordered.forEach((panelId, rank) => { const option = this.node('option', String(rank + 1) + (rank === 0 ? ' · First' : rank === ordered.length - 1 ? ' · Last' : '')); option.value = String(rank); position.append(option); });
      position.value = String(index);
      position.addEventListener('change', () => {
        const destination = Number(position.value);
        if (!Number.isInteger(destination) || destination < 0 || destination >= ordered.length || destination === index) return;
        const order = [...this.value.panelOrder], other = ordered[destination];
        order.splice(order.indexOf(id), 1);
        order.splice(order.indexOf(other) + (destination > index ? 1 : 0), 0, id);
        this.value.panelOrder = order;
        this.renderPanels(id); this.changed(panel.title + ' moved to position ' + (destination + 1) + ' of ' + ordered.length + '.');
      });
      positionLabel.append(this.node('span', 'Position'), position); actions.append(positionLabel);
      row.append(actions); this.list.append(row);
    });
    if (focus) {
      [...this.list.querySelectorAll('[data-position]')].find(select => select.dataset.position === focus)?.focus();
    }
  }
  changed(message) { this.status.textContent = message + ' Save changes to apply.'; this.onChange(structuredClone(this.value)); }
}
