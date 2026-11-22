import { prepareAvatar } from './admin-operations.js';
import { preferences, formatClock, validTimeZone } from './admin-preferences.js';
import { WorkspaceCustomizer } from './workspace-customizer.js';

export class AccountSettings {
  constructor({ api, onSaved, applyWorkspace = () => {} }) {
    this.api = api; this.onSaved = onSaved;
    this.document = document; this.window = document.defaultView;
    this.form = document.querySelector('#profile-form');
    this.$ = selector => this.form.querySelector(selector);
    this.photoRequest = 0;
    this.applyWorkspace = applyWorkspace;
    this.customizer = new WorkspaceCustomizer(this.$('#workspace-customization'), () => this.markDirty());
    this.buildTimeZones();
    this.form.addEventListener('input', () => { this.markDirty(); this.previewPhoto(); this.renderClock(); });
    this.form.addEventListener('change', event => { if (event.target.type !== 'file') { this.markDirty(); this.renderClock(); } });
    this.$('#profile-photo-pick').addEventListener('click', () => this.$('#profile-photo').click());
    this.$('#profile-remove-photo').addEventListener('click', () => { this.photoRequest++; this.photoBusy = false; this.avatar = ''; this.markDirty(); this.previewPhoto(); });
    this.$('#profile-photo').addEventListener('change', event => this.choosePhoto(event.target.files[0]));
    this.$('#profile-discard').addEventListener('click', () => this.load(this.profile, this.session));
    this.$('#settings-device-time').addEventListener('click', () => {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!validTimeZone(zone)) return;
      this.ensureZone(zone); this.$('#profile-timezone').value = zone; this.markDirty(); this.renderClock();
    });
    this.form.addEventListener('submit', event => { event.preventDefault(); this.save(); });
    this.window.addEventListener('pagehide', () => this.pauseClock());
    this.window.addEventListener('pageshow', () => this.setActive(this.active));
  }
  buildTimeZones() {
    const common = [
      ['America/New_York', 'Eastern Time · New York'], ['America/Chicago', 'Central Time · Chicago'],
      ['America/Denver', 'Mountain Time · Denver'], ['America/Los_Angeles', 'Pacific Time · Los Angeles'],
      ['America/Phoenix', 'Arizona · Phoenix'], ['America/Anchorage', 'Alaska · Anchorage'], ['Pacific/Honolulu', 'Hawaii · Honolulu'],
      ['America/Bogota', 'Colombia · Bogotá'], ['America/Jamaica', 'Jamaica'], ['UTC', 'UTC'],
    ];
    const select = this.$('#profile-timezone');
    common.forEach(([value, label]) => this.addZone(value, label, select));
    const others = this.document.createElement('optgroup'); others.label = 'Other timezones';
    (Intl.supportedValuesOf?.('timeZone') || []).filter(zone => !common.some(([value]) => value === zone)).forEach(zone => this.addZone(zone, zone.replaceAll('_', ' '), others));
    if (others.childElementCount) select.append(others);
  }
  addZone(value, label, parent) {
    const option = this.document.createElement('option'); option.value = value; option.textContent = label; parent.append(option);
  }
  ensureZone(zone) {
    if (![...this.$('#profile-timezone').options].some(option => option.value === zone)) this.addZone(zone, zone.replaceAll('_', ' '), this.$('#profile-timezone'));
  }
  load(profile, session) {
    this.profile = profile; this.session = session;
    const data = profile.data || {}, prefs = preferences(data);
    this.photoRequest++; this.photoBusy = false; this.dirty = false;
    this.avatar = data.avatar || '';
    this.$('#profile-display-name').value = data.displayName || session.role || 'Owner';
    this.$('#profile-phone').value = data.phone || '';
    this.$('#profile-job-title').value = data.jobTitle || '';
    this.ensureZone(prefs.timeZone);
    this.$('#profile-timezone').value = prefs.timeZone;
    this.$('#profile-time-format').value = prefs.timeFormat;
    this.customizer.load(data.workspace, session.permissions);
    this.applyWorkspace(this.customizer.value, session.permissions);
    this.$('#profile-photo').value = '';
    this.$('#profile-email').textContent = session.user.email;
    this.$('#profile-role').textContent = session.role;
    this.$('#profile-permission-note').textContent = session.permissions?.includes('content') ? 'Owner access: manage jobs, reminders, reviews, website content, and exports.' : 'Staff access: manage jobs, reminders, and your own profile.';
    this.status(''); this.previewPhoto(); this.updateButtons(); this.renderClock();
  }
  markDirty() { this.dirty = true; this.status(''); this.updateButtons(); }
  updateButtons() {
    this.$('#profile-save').disabled = !this.dirty || Boolean(this.photoBusy) || Boolean(this.saving);
    this.$('#profile-discard').disabled = (!this.dirty && !this.photoBusy) || Boolean(this.saving);
    this.$('#settings-save-label').textContent = this.dirty ? 'Unsaved changes. Save to apply.' : 'Your settings are up to date.';
  }
  status(text, error = false) {
    const status = this.$('#profile-status'); status.textContent = text; status.dataset.error = String(error);
    status.setAttribute('role', error ? 'alert' : 'status');
  }
  previewPhoto() {
    const preview = this.$('#profile-photo-preview'); preview.replaceChildren();
    if (this.avatar) { const image = this.document.createElement('img'); image.src = this.avatar; image.alt = 'Your profile photo'; preview.append(image); }
    else preview.textContent = (this.$('#profile-display-name').value.trim() || 'Owner').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    this.$('#profile-remove-photo').disabled = !this.avatar;
  }
  async choosePhoto(file) {
    if (!file) return;
    const request = ++this.photoRequest;
    this.photoBusy = true; this.updateButtons(); this.status('Preparing photo…');
    try {
      const photo = await prepareAvatar(file);
      if (request !== this.photoRequest) return;
      this.avatar = photo; this.markDirty(); this.previewPhoto();
    } catch (error) { if (request === this.photoRequest) this.status(error.message, true); }
    finally { if (request === this.photoRequest) { this.photoBusy = false; this.updateButtons(); } }
  }
  read() {
    return { ...Object.fromEntries(['displayName', 'phone', 'jobTitle', 'timeZone', 'timeFormat'].map(key => [key, this.form.elements[key].value.trim()])), workspace: structuredClone(this.customizer.value) };
  }
  async save() {
    if (this.photoBusy || this.saving || !this.form.reportValidity()) return;
    this.saving = true; this.updateButtons(); this.$('#settings-fields').disabled = true; this.status('Saving changes…');
    try {
      const saved = await this.api('profile', { ...this.read(), avatar: this.avatar, revision: this.profile.revision });
      this.onSaved(saved); this.status('Settings saved.');
    } catch (error) { this.status(error.message || 'Settings could not be saved. Try again.', true); }
    finally { this.saving = false; this.$('#settings-fields').disabled = false; this.updateButtons(); }
  }
  renderClock() {
    const now = new Date(), prefs = preferences(this.read());
    this.$('#settings-clock').textContent = formatClock(now, prefs);
    this.$('#settings-clock').dateTime = now.toISOString();
    this.$('#settings-clock-date').textContent = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: prefs.timeZone }).format(now);
    this.$('#settings-clock-zone').textContent = this.$('#profile-timezone').selectedOptions[0]?.textContent || prefs.timeZone;
  }
  pauseClock() {
    if (this.timer) this.window.clearInterval(this.timer);
    this.timer = undefined;
  }
  setActive(active) {
    this.active = active;
    this.pauseClock();
    if (active) { this.renderClock(); this.timer = this.window.setInterval(() => { if (!this.document.hidden) this.renderClock(); }, 1000); }
  }
}
