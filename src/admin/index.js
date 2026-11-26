import { Enquiries } from './enquiries/index.ts';
import { addDetail } from './enquiries/detail.ts';
import { createWebsiteEditor } from './website/editor.js';
import { enquiryHash, enquiryLinkNumber } from '../domain/jobs/job-number.ts';
import { isQuote } from '../domain/jobs/types.ts';
import { completeOwnerAccess, prepareOwnerAccess, signInWithGoogle } from '../owner-access.js';
import { clearLoginQuery, createAdminLogin } from '../../public/assets/admin-login.js';
import { node, icon, initials, picture, statusLabel, emptyState } from '../../public/assets/admin-ui.js';
import { OperationsBoard } from '../../public/assets/admin-operations.js';
import { calendarEvents } from '../../public/assets/admin-data.js';
import { businessDateKey as dateKey } from '../domain/jobs/dates.ts';
import { AccountSettings } from '../../public/assets/admin-settings.js';
import { preferences, formatTimestamp, formatBusinessTime } from '../../public/assets/admin-preferences.js';
import { WorkspaceNotice } from '../../public/assets/admin-notice.js';
import { LiquidNavigation, setupMobileWorkspace } from '../../public/assets/admin-navigation.js';
import { WorkspaceLayout } from '../../public/assets/workspace-layout.js';
import { WorkspaceIdle } from '../../public/assets/admin-session.js';
import { recoveryPreview } from '../../public/assets/admin-recovery.js';
import { WorkspaceAssistant } from '../../public/assets/admin-assistant.js';
import { WorkspaceEmail } from './email.ts';
import { SubmissionBackupsPanel } from './submission-backups.ts';
import { WorkspaceNotifications } from './notifications.ts';
import { ReviewWorkspace } from './reviews.js';

clearLoginQuery(window.location, window.history);
const $ = selector => document.querySelector(selector);
const notice = new WorkspaceNotice($('#owner-notice'));
const workspace = $('#owner-workspace');
const signIn = $('#owner-signin');
const navigation = new LiquidNavigation($('.owner-navigation'));
const workspaceLayout = new WorkspaceLayout(document, () => switchView('settings'));
const assistant = new WorkspaceAssistant({ onExpired: lockWorkspace });
setupMobileWorkspace($('#assistant-open'), $('#workspace-notifications'), $('#owner-sidebar'));
const emailView = $('#owner-email-view');
const email = new WorkspaceEmail(emailView, api);
let items = [], localPreview = false;
let permissions = [], reminders = { data: [], revision: null }, activity = [], profile = { data: null, revision: null }, sessionUser, currentReminder;
let sessionLocked = false;
let inboxRequest = 0;
const idle = new WorkspaceIdle({
  dialog: $('#workspace-idle-dialog'),
  touch: () => api('session-touch', {}),
  check: () => api('session'),
  end: lockWorkspace,
});
const accountSettings = new AccountSettings({ api, applyWorkspace: (value, permissions) => {
  workspaceLayout.apply(value, permissions);
  if (website.published) operations.update(items, reminders.data);
}, onSaved: saved => {
  profile = saved; applyProfile(); renderOverview(); enquiries.render(); reviewWorkspace.render();
  announce('Settings saved', { detail: 'Your profile, time, and workspace preferences are updated.' });
} });
const views = {
  overview: ['Overview', 'YOUR BUSINESS, AT A GLANCE', 'A clear view of what needs your attention.'],
  enquiries: ['Enquiries', 'REQUESTS & JOBS', 'Choose a request to see its route, customer, and next steps.'],
  email: ['Email', '', ''],
  reviews: ['Customer reviews', '', 'Choose which customer reviews appear on your homepage.'],
  website: ['Your website', 'CONTENT STUDIO', 'Open a section to edit. See your changes before you publish.'],
  settings: ['Settings', 'YOUR WORKSPACE, YOUR WAY', 'Personalize your layout, profile, and time preferences.'],
};
const viewPermissions = { reviews: 'reviews', website: 'content', email: 'email' };
const quotes = () => items.filter(isQuote);
const reviews = () => items.filter(item => (item.form_name || item.data['form-name']) === 'customer-review');
const newPublishableReviews = () => reviews().filter(item => !item.state && item.data['publish-permission'] === 'yes').length;
const date = value => formatTimestamp(value, profile.data);
const shortDate = value => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: preferences(profile.data).timeZone }) : '';
const notifications = new WorkspaceNotifications($('#workspace-notifications'), {
  formatDate: date,
  refresh: loadItems,
  openEnquiry: showRequest,
  openReview: item => {
    switchView('reviews');
    reviewWorkspace.openReview(item.id);
  },
});
const login = createAdminLogin({ api, completeAccess: completeOwnerAccess, googleSignIn: signInWithGoogle, onSignedIn: start });
const announce = (text, options) => {
  if (!signIn.hidden) { notice.hide(); login.message(text, options); }
  else notice.show(text, options);
};
const reviewWorkspace = new ReviewWorkspace($('#owner-reviews'), {
  date: shortDate,
  save: data => api('review', data),
  refresh: loadItems,
  announce,
});

function showLogin() {
  workspace.hidden = true;
  assistant.setAvailable(false);
  email.reset();
  notifications.stop();
  idle.stop();
  workspaceLayout.clear();
  accountSettings.setActive(false);
  signIn.hidden = false; $('#owner-sidebar').hidden = true;
  $('#profile-open').hidden = true; $('#owner-logout').hidden = true;
  document.body.classList.remove('owner-authenticated');
  document.body.classList.add('owner-login-screen');
}

function lockWorkspace() {
  if (sessionLocked) return;
  sessionLocked = true;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  showLogin();
  const url = new URL(location.href);
  url.searchParams.set('session-ended', '1');
  location.replace(url);
}

async function api(action, data, query = {}) {
  const options = data ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  } : {};
  if (action === 'session' || action === 'session-touch') options.signal = AbortSignal.timeout(8000);
  if (action === 'email-draft') options.signal = AbortSignal.timeout(15000);
  const emailAction = action.startsWith('email-');
  const endpoint = emailAction ? 'workspace-email' : ['login', 'recovery'].includes(action) ? 'owner-auth' : 'owner';
  const response = await fetch('/.netlify/functions/' + endpoint + '?' + new URLSearchParams({ action: emailAction ? action.slice(6) : action, ...query }), options);
  const result = await response.json().catch(() => ({ error: 'The server did not respond. Try again.' }));
  if (!response.ok) {
    if (response.status === 401 && signIn.hidden) lockWorkspace();
    else if (response.status === 401 || (response.status === 403 && ['session', 'login'].includes(action))) showLogin();
    const message = response.status === 429 && action !== 'email-send'
      ? 'Too many requests. Wait a minute and try again.' : result.error || 'This action could not be completed.';
    throw Object.assign(new Error(message), { status: response.status, code: result.code });
  }
  return result;
}

async function run(button, task) {
  button.disabled = true;
  try { await task(); } catch (error) { announce(error.message, { tone: 'error' }); }
  finally { if (button.isConnected) button.disabled = false; }
}

function switchView(view, jobNumber) {
  if (!Object.hasOwn(views, view)) return;
  if (Object.hasOwn(viewPermissions, view) && !permissions.includes(viewPermissions[view])) view = 'overview';
  const activeView = view === 'email' ? emailView : $('#owner-' + view);
  const changed = activeView.hidden;
  const [title, eyebrow, description] = views[view];
  $('#workspace-title').textContent = title;
  $('#owner-eyebrow').textContent = eyebrow; $('#owner-eyebrow').hidden = !eyebrow;
  $('#workspace-description').textContent = description; $('#workspace-description').hidden = !description;
  document.querySelectorAll('.owner-view').forEach(section => { section.hidden = section !== activeView; });
  operations.setMapActive(view === 'overview');
  document.querySelectorAll('.owner-navigation [data-owner-view]').forEach(button => {
    if (button.dataset.ownerView === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  navigation.select(document.querySelector('.owner-navigation [aria-current]'));
  if (view === 'settings') $('#profile-open').setAttribute('aria-current', 'page');
  else $('#profile-open').removeAttribute('aria-current');
  assistant.setView(view);
  accountSettings.setActive(view === 'settings');
  if (view === 'settings' && changed && permissions.includes('backups')) void backupsPanel.load();
  const hash = view === 'enquiries' && jobNumber ? enquiryHash(jobNumber) : '#' + view;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  email.setActive(view === 'email');
  if (changed) {
    const heading = $('#workspace-title'); heading.tabIndex = -1; heading.focus({ preventScroll: true });
    const scroller = document.scrollingElement || document.documentElement;
    scroller.scrollTop = 0;
  }
}

const website = createWebsiteEditor({
  api, run, announce, openWebsite: () => switchView('website'), isLocalPreview: () => localPreview,
  onPublish: saved => { addActivity(saved); renderOverview(); },
});

function addActivity(saved) {
  const entry = saved.data?.history?.[0];
  if (entry && permissions.includes('activity')) activity = [entry, ...activity].slice(0, 50);
}

const enquiries = new Enquiries({
  date, shortDate, time: value => formatBusinessTime(value, profile.data),
  canRestore: () => permissions.includes('content'),
  onHistory: openRecovery,
  onSave: (item, fields, revision) => api('enquiry', { id: item.id, revision, ...fields }),
  onSaved: saved => { addActivity(saved); renderOverview(); announce('Enquiry saved.'); },
  onSelect: (item, compact) => {
    if (!item.jobNumber) return;
    const hash = enquiryHash(item.jobNumber);
    if (hash === location.hash) return;
    if (compact) history.pushState({ enquiryFromList: true }, '', hash);
    else history.replaceState(null, '', hash);
  },
  onBack: returnToEnquiries,
  onError: error => announce(error.message || 'The enquiry could not be updated.', { tone: 'error' }),
});

function openEnquiryList(restorePosition = false) {
  enquiries.showInbox(restorePosition && !$('#owner-enquiries').hidden);
  switchView('enquiries');
}

function returnToEnquiries() {
  if (history.state?.enquiryFromList) history.back();
  else openEnquiryList(true);
}

function showRequest(item) {
  if (!item) return;
  enquiries.open(item);
  switchView('enquiries', item.jobNumber);
  enquiries.focusDetail();
}

function renderOverview(inboxFresh = false) {
  notifications.update(items, inboxFresh);
  const all = quotes();
  const newCount = all.filter(item => !item.state || item.state.status === 'New').length;
  const active = all.filter(item => item.state && ['Contacted', 'Quoted', 'Booked'].includes(item.state.status)).length;
  const pending = newPublishableReviews();
  const metrics = $('#overview-metrics'); metrics.replaceChildren();
  for (const [label, count, hint, iconName, view, filter] of [
    ['New enquiries', newCount, 'Waiting for your first reply', 'inbox', 'enquiries', 'New'],
    ['Active requests', active, 'Contacted, quoted, or booked', 'truck', 'enquiries', 'active'],
    ...(permissions.includes('reviews') ? [['Reviews to check', pending, 'New feedback you can show', 'star', 'reviews', 'ready']] : []),
  ]) {
    const card = node('button', undefined, 'metric-card'); card.type = 'button';
    const graphic = node('span', undefined, 'metric-icon'); graphic.append(icon(iconName));
    card.append(node('span', label, 'metric-label'), graphic, node('strong', String(count)), node('small', hint));
    card.addEventListener('click', () => {
      if (view === 'enquiries') enquiries.setFilter(filter);
      else reviewWorkspace.setFilter(filter);
      switchView(view);
    }); metrics.append(card);
  }
  const recent = $('#overview-recent'); recent.replaceChildren();
  if (!all.length) recent.append(emptyState('Ready for your next request', 'New quote requests will appear here.'));
  all.slice(0, 4).forEach(item => {
    const row = node('button', undefined, 'recent-row'); row.type = 'button';
    const text = node('span'); text.append(node('strong', item.data.name || 'Customer'), node('small', (item.jobNumber ? item.jobNumber + '  |  ' : '') + item.data.pickup + ' · ' + (item.data.dropoff === 'Unsure' ? 'Drop-off not decided' : item.data.dropoff)));
    row.append(node('span', initials(item.data.name), 'initials'), text, statusLabel(item.state?.status));
    row.addEventListener('click', () => showRequest(item)); recent.append(row);
  });
  operations.update(items, reminders.data);
  const attention = $('#overview-attention'); attention.replaceChildren();
  const upcoming = calendarEvents(items, reminders.data).filter(event => !event.done && event.kind !== 'requested' && (event.kind !== 'pickup' || event.date >= dateKey())).slice(0, 4);
  upcoming.forEach(event => {
    const row = node('button', undefined, 'attention-row'); row.type = 'button'; const text = node('span');
    text.append(node('strong', event.title), node('small', event.label + ' · ' + event.date + (event.date < dateKey() ? ' · Overdue' : '')));
    row.append(icon(event.kind === 'pickup' ? 'truck' : 'calendar-days'), text); row.addEventListener('click', () => event.kind === 'reminder' ? openReminder(reminders.data.find(task => task.id === event.id)) : showRequest(items.find(item => item.id === event.itemId))); attention.append(row);
  });
  if (pending) {
    const row = node('button', undefined, 'attention-row'); row.type = 'button'; const text = node('span');
    text.append(node('strong', pending + (pending === 1 ? ' review to check' : ' reviews to check')), node('small', 'Decide what to show on the homepage'));
    row.append(icon('star'), text); row.addEventListener('click', () => { reviewWorkspace.setFilter('ready'); switchView('reviews'); }); attention.append(row);
  }
  if (!upcoming.length && !pending) attention.append(emptyState('You’re up to date', 'No scheduled follow-ups or unchecked reviews.', 'check'));
  renderActivity();
}

const recoveryDialog = $('#workspace-recovery');
let recovery;
async function openRecovery(item) {
  const draft = item ? enquiries.hasDraft(item.id) : website.hasDraft;
  if (draft) throw new Error('Save or discard your edits before restoring an earlier version.');
  const data = await api('versions', undefined, item ? { id: item.id } : {});
  if (item ? enquiries.hasDraft(item.id) : website.hasDraft) return;
  recovery = { ...data, item };
  const select = $('#recovery-version');
  select.replaceChildren(...data.versions.map((version, index) => new Option(
    (index === 0 ? 'Most recent' : 'Version ' + (index + 1)) + ' · ' + date(version.at), version.id)));
  select.disabled = !data.versions.length;
  $('#recovery-status').textContent = '';
  $('#recovery-title').textContent = item ? 'Enquiry version history' : 'Website version history';
  $('#recovery-effect').textContent = item ? 'Restore replaces the saved enquiry fields and keeps the current version in history.' : 'Restore publishes the selected website version and keeps the current version in history.';
  renderRecovery();
  recoveryDialog.showModal();
}

function renderRecovery() {
  const version = recovery.versions.find(entry => entry.id === $('#recovery-version').value);
  const preview = $('#recovery-preview');
  preview.replaceChildren();
  if (version) {
    for (const [label, value] of recoveryPreview(version.data, recovery.current, Boolean(recovery.item))) addDetail(preview, label, value || '—');
  }
  $('#recovery-status').textContent = version ? '' : 'Previous versions appear here after saved changes.';
  if (version && !preview.childElementCount) $('#recovery-status').textContent = 'This version matches the current website content.';
  $('#recovery-restore').disabled = !version || !preview.childElementCount;
}

$('#recovery-version').addEventListener('change', renderRecovery);
$('#recovery-restore').addEventListener('click', async () => {
  const button = $('#recovery-restore'), select = $('#recovery-version');
  const { item, revision } = recovery;
  const version = select.value;
  button.disabled = select.disabled = true;
  $('#recovery-status').textContent = 'Restoring…';
  try {
    const result = await api('versions', { id: item?.id, version, revision });
    if (item) enquiries.applySaved(item, result);
    else website.load(result);
    addActivity(result);
    renderOverview();
    recoveryDialog.close();
    announce(item ? 'Enquiry version restored.' : 'Website version restored and published.');
    (item ? $('#enquiry-tab-2') : $('#website-versions'))?.focus();
  } catch (error) {
    $('#recovery-status').textContent = error.message;
  } finally {
    button.disabled = select.disabled = false;
  }
});

async function loadItems() {
  const request = ++inboxRequest;
  const result = await api('list');
  if (request !== inboxRequest || !signIn.hidden) return;
  items = result.items;
  reminders = result.reminders || { data: [], revision: null }; activity = result.activity || [];
  renderQuoteAlerts(result.quoteAlerts);
  enquiries.setItems(quotes());
  const pendingReviews = newPublishableReviews();
  $('#review-count').textContent = String(pendingReviews);
  $('#review-count').hidden = pendingReviews === 0;
  reviewWorkspace.load(reviews(), result.homepageReviews || []);
  renderOverview(true);
}

const backupsPanel = new SubmissionBackupsPanel($('#submission-backups'), {
  status: () => api('backups'),
  capture: () => api('backups', { operation: 'capture' }),
  restore: id => api('backups', { operation: 'restore', id }),
}, loadItems);

function renderQuoteAlerts(alerts) {
  const summary = $('#enquiry-alert-summary');
  if (!summary) return;
  const missed = day => day.skipped + day.failed;
  summary.hidden = !alerts || (!alerts.enabled && !missed(alerts.today) && !missed(alerts.previous));
  if (summary.hidden) return;
  const { today, previous } = alerts;
  const stats = [today.sent + ' sent', today.pending + ' pending'];
  if (today.failed) stats.push(today.failed + ' failed');
  if (today.skipped) stats.push((today.lowerBound ? 'At least ' : '') + today.skipped + ' skipped at the daily limit');
  const yesterday = missed(previous);
  $('#enquiry-alert-counts').textContent = stats.join(' · ') + (yesterday ?
    '. Yesterday, ' + (previous.lowerBound ? 'at least ' : '') + yesterday + ' missed.' : '.');
}

function renderActivity() {
  const container = $('#recent-activity'); container.replaceChildren();
  if (!activity.length) container.append(node('p', 'Saved changes will appear here.', 'owner-empty'));
  activity.slice(0, 15).forEach(entry => {
    const item = items.find(item => item.id === entry.subject);
    const row = node('div', undefined, 'activity-row');
    const subject = item ? [item.jobNumber, item.data.name].filter(Boolean).join('  |  ') : entry.subject;
    row.append(node('strong', entry.action), node('span', subject), node('small', date(entry.at) + ' · ' + entry.actor)); container.append(row);
  });
}

function openReminder(task = {}) {
  currentReminder = task.id ? task : { id: crypto.randomUUID(), title: '', date: task.date || dateKey(), done: false };
  const form = $('#reminder-form'); form.elements.title.value = currentReminder.title; form.elements.date.value = currentReminder.date; form.elements.done.checked = currentReminder.done;
  $('#reminder-done-field').hidden = !task.id; $('#reminder-title').textContent = task.id ? 'Edit reminder' : 'Add reminder'; $('#reminder-status').textContent = '';
  $('#reminder-dialog').showModal(); form.elements.title.focus();
}
async function saveReminder(task) {
  reminders = await api('reminder', { id: task.id, title: task.title, date: task.date, done: task.done, revision: reminders.revision });
  await loadItems();
}
function avatarContent(element, avatar, name) {
  element.replaceChildren(avatar ? picture(avatar, '') : node('span', initials(name)));
}
function applyProfile() {
  const name = profile.data?.displayName || sessionUser.role || 'Owner';
  $('#header-profile-name').textContent = name; avatarContent($('#header-avatar'), profile.data?.avatar, name);
  $('#header-profile-role').textContent = (sessionUser.role || 'Owner') + ' account';
  $('#profile-open').hidden = false;
  $('.brand-caption').textContent = sessionUser.role === 'Staff' ? 'STAFF WORKSPACE' : 'OWNER WORKSPACE';
  $('.sidebar-brand-caption').textContent = sessionUser.role === 'Staff' ? 'Staff workspace' : 'Owner workspace';
  accountSettings.load(profile, sessionUser);
  $('#owner-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: preferences(profile.data).timeZone });
}

const operations = new OperationsBoard({ openEnquiry: showRequest, editReminder: openReminder, toggleReminder: (task, done) => saveReminder({ ...task, done }), notify: text => announce(text, { tone: 'error' }), getPreferences: () => profile.data });
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close()));
$('#reminder-form').addEventListener('submit', event => {
  event.preventDefault(); const button = event.submitter, form = event.currentTarget;
  button.disabled = true; $('#reminder-status').textContent = '';
  saveReminder({ ...currentReminder, title: form.elements.title.value.trim(), date: form.elements.date.value, done: form.elements.done.checked })
    .then(() => { $('#reminder-dialog').close(); announce('Reminder saved', { detail: 'Your reminder is on the calendar.' }); }).catch(error => { $('#reminder-status').textContent = error.message; }).finally(() => { button.disabled = false; });
});
$('#profile-open').addEventListener('click', () => switchView('settings'));

document.querySelectorAll('[data-owner-view]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.ownerView === 'enquiries') returnToEnquiries();
  else switchView(button.dataset.ownerView);
}));
document.querySelectorAll('.owner-refresh').forEach(button => button.addEventListener('click', () => run(button, async () => { await loadItems(); announce('Enquiries and reviews refreshed.'); })));
$('#website-versions').addEventListener('click', event => run(event.currentTarget, () => openRecovery()));
window.addEventListener('beforeunload', event => { if (!sessionLocked && (website.hasDraft || enquiries.dirty || accountSettings.dirty)) { event.preventDefault(); event.returnValue = ''; } });

$('#owner-logout').addEventListener('click', event => run(event.currentTarget, async () => { await api('logout', {}); location.reload(); }));

function openWorkspaceHash() {
  const number = enquiryLinkNumber(location.hash);
  if (number) {
    if (enquiries.openNumber(number, history.state?.enquiryFromList === true)) {
      switchView('enquiries', number);
      enquiries.focusDetail();
    } else {
      openEnquiryList();
      announce('Job number unavailable', { tone: 'info', detail: 'Try searching Enquiries for the job number.' });
    }
    return;
  }
  const view = location.hash.slice(1);
  if (view === 'enquiries') openEnquiryList(true);
  else switchView(Object.hasOwn(views, view) ? view : 'overview');
}
window.addEventListener('hashchange', () => { if (!workspace.hidden) openWorkspaceHash(); });

async function start() {
  try {
    const session = await api('session'); localPreview = session.localPreview;
    sessionUser = session; permissions = session.permissions || [];
    assistant.setAvailable(session.assistantAvailable === true);
    idle.start(session.expiresAt);
    const url = new URL(location.href);
    if (url.searchParams.has('session-ended')) {
      url.searchParams.delete('session-ended');
      history.replaceState(null, '', url);
    }
    document.querySelectorAll('[data-permission]').forEach(element => { element.hidden = !permissions.includes(element.dataset.permission); });
    $('#overview-metrics').classList.toggle('staff-metrics', !permissions.includes('reviews'));
    $('#owner-preview-note').hidden = !localPreview; $('#owner-logout').hidden = localPreview; $('#owner-account').textContent = session.user.email;
    signIn.hidden = true; workspace.hidden = false; $('#owner-sidebar').hidden = false;
    notifications.start(session.user.id, permissions.includes('reviews'));
    document.body.classList.remove('owner-login-screen'); document.body.classList.add('owner-authenticated'); announce('');
    const [result, savedProfile] = await Promise.all([api('content'), api('profile')]); profile = savedProfile; applyProfile();
    website.load(result);
    await loadItems();
    openWorkspaceHash();
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      const url = new URL(location.href);
      const ended = url.searchParams.has('session-ended');
      if (ended) {
        url.searchParams.delete('session-ended');
        history.replaceState(history.state, '', url);
      }
      login.message(ended ? 'Your workspace session ended. Please sign in again.' : '');
    }
    else announce(error.message, { tone: 'error' });
  }
}
try {
  const previewLogin = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && new URLSearchParams(location.search).get('login') === 'preview';
  if (previewLogin) {
    showLogin(); $('#login-preview-note').hidden = false;
  } else {
    const callback = await prepareOwnerAccess();
    if (callback === 'invite' || callback === 'recovery') { showLogin(); login.setPasswordMode(); }
    else {
      if (callback === 'oauth') await api('session-start', {});
      await start();
    }
  }
} catch (error) { showLogin(); announce(error.message || 'Owner access could not be initialized. Enable Identity and invite the owner in Netlify.', { tone: 'error' }); }
