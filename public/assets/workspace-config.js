// Shared by the browser and the profile validator. New panels need one registry
// entry and a matching DOM selector; older preferences pick them up automatically.
export const workspacePanels = [
  { id: 'summary', title: 'At a glance', description: 'Counts for new requests, active jobs, and reviews.', selector: '.overview-metrics', wide: true },
  { id: 'recent', title: 'Recent enquiries', description: 'Your latest customer requests.', selector: '.recent-panel' },
  { id: 'map', title: 'Job locations', description: 'Pickup and drop-off locations on a map.', selector: '.jobs-map-panel' },
  { id: 'calendar', title: 'Calendar', description: 'Pickups, follow-ups, and reminders.', selector: '.calendar-panel' },
  { id: 'quickEdits', title: 'Quick edits', description: 'Shortcuts to website content and availability.', selector: '.quick-edit-panel', permission: 'content' },
  { id: 'nextUp', title: 'Next up', description: 'Upcoming tasks and feedback to check.', selector: '.followup-panel' },
  { id: 'activity', title: 'Recent changes', description: 'A history of saved workspace updates.', selector: '.activity-panel', permission: 'activity' },
];
export const workspaceThemes = [
  { id: 'rs-red', title: 'RS red', description: 'The original RS accent.' },
  { id: 'graphite', title: 'Graphite', description: 'Quiet black and white.' },
  { id: 'ocean', title: 'Ocean', description: 'Cool blue and silver.' },
  { id: 'forest', title: 'Forest', description: 'Soft green and stone.' },
];
export const mobileWorkspaceQuery = '(max-width: 1100px)';
export const workspacePresets = [
  { id: 'compact', title: 'Compact', description: 'Closer spacing. More in view.', layout: 'equal', fontSize: 100, gap: 14, padding: 18 },
  { id: 'balanced', title: 'Balanced', description: 'A comfortable everyday layout.', layout: 'balanced', fontSize: 100, gap: 22, padding: 24 },
  { id: 'spacious', title: 'Spacious', description: 'Larger text. Room to focus.', layout: 'single', fontSize: 110, gap: 28, padding: 30 },
];
export const workspaceLayouts = [ ['balanced', 'Two columns · wider left'], ['equal', 'Two equal columns'], ['single', 'One column'] ];
export const workspaceFontSizes = [100, 110, 125];
export function workspaceDefaults() {
  return { version: 1, theme: 'rs-red', preset: 'balanced', layout: 'balanced', fontSize: 100, hiddenPanels: [], panelOrder: workspacePanels.map(panel => panel.id) };
}
export function resolveWorkspace(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) && (!value.version || value.version === 1) ? value : {};
  const preset = workspacePresets.find(item => item.id === raw.preset) || workspacePresets[1];
  const ids = workspacePanels.map(panel => panel.id);
  const known = list => [...new Set(Array.isArray(list) ? list.filter(id => ids.includes(id)) : [])];
  return { version: 1, theme: workspaceThemes.some(theme => theme.id === raw.theme) ? raw.theme : 'rs-red', preset: preset.id,
    layout: workspaceLayouts.some(([id]) => id === raw.layout) ? raw.layout : preset.layout,
    fontSize: workspaceFontSizes.includes(raw.fontSize) ? raw.fontSize : preset.fontSize,
    hiddenPanels: known(raw.hiddenPanels), panelOrder: [...known(raw.panelOrder), ...ids.filter(id => !known(raw.panelOrder).includes(id))] };
}
export function validateWorkspace(value) {
  const fail = () => { throw Object.assign(new Error('Check your workspace preferences.'), { status: 400 }); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  if (value.version !== 1 || !workspacePresets.some(preset => preset.id === value.preset) ||
      !workspaceLayouts.some(([id]) => id === value.layout) || !workspaceFontSizes.includes(value.fontSize)) fail();
  if (value.theme !== undefined && !workspaceThemes.some(theme => theme.id === value.theme)) fail();
  for (const list of [value.panelOrder, value.hiddenPanels]) {
    if (!Array.isArray(list) || list.length > workspacePanels.length || new Set(list).size !== list.length || list.some(id => !workspacePanels.some(panel => panel.id === id))) fail();
  }
  return resolveWorkspace(value);
}
export function effectiveWorkspace(value, mobile = false) {
  const settings = resolveWorkspace(value);
  const preset = workspacePresets.find(item => item.id === settings.preset);
  // Layout and typography now come from one preset. Keep legacy fine-tuning
  // fields readable in stored profiles, but no longer apply those overrides.
  return mobile ? { ...settings, preset: 'balanced', layout: 'single', fontSize: 100, panelOrder: workspaceDefaults().panelOrder }
    : { ...settings, layout: preset.layout, fontSize: preset.fontSize };
}
export function availablePanels(permissions = []) {
  return workspacePanels.filter(panel => !panel.permission || permissions.includes(panel.permission));
}
