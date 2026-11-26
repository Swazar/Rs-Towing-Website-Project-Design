import { node, statusLabel } from './admin-ui.js';
import { locationPoint } from './admin-data.js';
import { addBasemap, drivingDirectionsUrl, loadLeaflet } from './route-map.js';

const stopKinds = [
  { key: 'pickup', label: 'Pickup', letter: 'A' },
  { key: 'dropoff', label: 'Drop-off', letter: 'B' },
];

function jobStops(job, places) {
  return stopKinds.map(kind => {
    const entered = String(job.data[kind.key] || '').trim();
    const address = entered && entered.toLowerCase() !== 'unsure' ? entered : '';
    return { ...kind, job, address, location: address ? locationPoint(job, kind.key, places) : null };
  });
}

function directionsFor(stops) {
  const [pickup, dropoff] = stops.map(stop => stop.address);
  if (pickup && dropoff) return drivingDirectionsUrl(pickup, dropoff);
  const address = pickup || dropoff;
  if (!address) return '';
  const url = new URL('https://www.google.com/maps/search/');
  url.search = new URLSearchParams({ api: '1', query: address }).toString();
  return url.href;
}

function makeStopRow(stop) {
  const row = node('li', undefined, 'job-map-stop');
  const badge = node('span', stop.letter, 'job-stop-badge');
  badge.dataset.stop = stop.key;
  badge.setAttribute('aria-hidden', 'true');
  const copy = node('div', undefined, 'job-map-stop-copy');
  copy.append(node('span', stop.label, 'job-map-stop-label'),
    node('strong', stop.address || (stop.key === 'dropoff' ? 'Not decided' : 'Not provided')));
  if (stop.address && !stop.location) copy.append(node('small', 'Needs confirmation'));
  else if (stop.location?.approximate) copy.append(node('small', 'Approximate pin'));
  row.append(badge, copy);
  return row;
}

export class JobMap {
  constructor(panel, openEnquiry) {
    this.panel = panel;
    this.openEnquiry = openEnquiry;
    const get = suffix => panel.querySelector('#overview-map-' + suffix);
    this.element = panel.querySelector('#overview-job-map');
    this.select = get('request');
    this.summary = get('summary');
    this.meta = get('meta');
    this.stops = get('stops');
    this.placeholder = get('placeholder');
    this.fitButton = get('fit');
    this.legend = get('legend');
    this.caption = get('caption');
    this.actions = get('actions');
    this.routeButton = get('route');
    this.directions = get('directions');
    this.jobs = [];
    this.selectedId = '';
    this.routeCache = new Map();
    this.version = 0;
    this.select.addEventListener('change', () => {
      this.selectedId = this.select.value;
      void this.render();
    });
    this.fitButton.addEventListener('click', () => this.fitStops());
    this.routeButton.addEventListener('click', () => this.previewRoute());
    get('open').addEventListener('click', () => this.openEnquiry(this.selectedJob));
  }

  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    if (active) void this.render();
    else this.cancelPending();
  }

  update(jobs) {
    this.jobs = jobs.filter(job => job.state?.status !== 'Closed');
    const signature = JSON.stringify(this.jobs.map(({ id, jobNumber, data, state }) => [
      id, jobNumber, data.name, data.service, state?.status,
      ...stopKinds.flatMap(({ key }) => [data[key], data[key + '_point'], data[key + '_accuracy']]),
    ]));
    const visible = this.active && !this.panel.closest('[hidden]');
    if (signature === this.signature && visible === this.visible) return;
    this.signature = signature;
    this.visible = visible;
    if (this.selectedId && !this.selectedJob) this.selectedId = '';
    this.select.replaceChildren(new Option('All open enquiries', ''), ...this.jobs.map(job =>
      new Option([job.jobNumber, job.data.name || 'Customer'].filter(Boolean).join(' · '), job.id)));
    this.select.value = this.selectedId;
    void this.render();
  }

  get selectedJob() { return this.jobs.find(job => job.id === this.selectedId); }

  cancelPending() {
    this.version++;
    this.routeRequest?.abort();
    this.routeRequest = undefined;
  }

  renderSelection(job, stops) {
    this.summary.hidden = !job;
    this.actions.hidden = !job;
    this.routeButton.hidden = true;
    this.routeButton.disabled = false;
    this.routeButton.textContent = 'Preview route';
    if (!job) return;
    this.meta.replaceChildren(node('span', job.data.service || 'Quote request'), statusLabel(job.state?.status));
    this.stops.replaceChildren(...stops.map(makeStopRow));
    const directions = directionsFor(stops);
    this.directions.hidden = !directions;
    if (directions) this.directions.href = directions;
    else this.directions.removeAttribute('href');
  }

  showPlaceholder(message, retry = false) {
    this.element.hidden = this.fitButton.hidden = this.legend.hidden = true;
    this.placeholder.hidden = false;
    this.placeholder.replaceChildren(node('p', message));
    if (retry) {
      const button = node('button', 'Retry map', 'quiet-button');
      button.type = 'button';
      button.addEventListener('click', () => this.render());
      this.placeholder.append(button);
    }
  }

  async render() {
    this.cancelPending();
    this.visible = this.active && !this.panel.closest('[hidden]');
    if (!this.visible) return;
    const version = this.version;
    const job = this.selectedJob;
    const jobs = job ? [job] : this.jobs;
    this.routeStops = undefined;
    this.routeVisible = false;
    this.caption.textContent = '';
    this.road?.clearLayers();
    this.renderSelection(job, job ? jobStops(job, this.places) : []);
    if (!jobs.length) {
      this.showPlaceholder('Open enquiries with pickup or drop-off information will appear here.');
      return;
    }
    this.showPlaceholder('Loading job locations…');
    try {
      this.placeRequest ??= fetch('/assets/us-places.json').then(response => {
        if (!response.ok) throw new Error('Locations unavailable');
        return response.json();
      }).catch(() => { this.placeRequest = undefined; });
      this.places = await this.placeRequest;
      if (version !== this.version) return;
      const stops = jobs.flatMap(entry => jobStops(entry, this.places));
      if (job) this.renderSelection(job, stops);
      const mapped = stops.filter(stop => stop.location);
      if (!mapped.length) {
        this.showPlaceholder('No pins are available for these stops. Check the addresses in Enquiries.');
        return;
      }
      const L = this.L ?? await loadLeaflet();
      if (version !== this.version) return;
      this.placeholder.hidden = true;
      this.element.hidden = false;
      this.initializeMap(L);
      this.drawPins(mapped);
      this.fitButton.hidden = false;
      this.legend.hidden = Boolean(job);
      this.fitStops();
      const [from, to] = stops;
      this.routeStops = job && from.location && to.location &&
        from.location.point.join(',') !== to.location.point.join(',') ? [from, to] : undefined;
      this.routeButton.hidden = !this.routeStops;
      if (!job) {
        const approximate = mapped.filter(stop => stop.location.approximate).length;
        const missing = stops.filter(stop => stop.address && !stop.location).length;
        this.caption.textContent = [
          mapped.length + (mapped.length === 1 ? ' stop mapped' : ' stops mapped'),
          approximate ? approximate + ' approximate' : '',
          missing ? missing + ' need confirmation' : '',
        ].filter(Boolean).join(' · ');
      }
    } catch {
      if (version === this.version) this.showPlaceholder('The map couldn’t load. You can still open the enquiry or use Google Maps.', true);
    }
  }

  initializeMap(L) {
    if (this.map) return;
    const map = L.map(this.element, { scrollWheelZoom: false }).setView([39, -98], 4);
    try { addBasemap(map); }
    catch (error) { map.remove(); throw error; }
    this.L = L;
    this.map = map;
    this.pins = L.featureGroup().addTo(map);
    this.road = L.layerGroup().addTo(map);
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => {
        if (this.element.offsetWidth) map.invalidateSize({ pan: false });
      });
      this.resize.observe(this.element);
    }
  }

  drawPins(stops) {
    this.pins.clearLayers();
    const groups = new Map();
    for (const stop of stops) {
      const key = stop.location.point.join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(stop);
    }
    for (const group of groups.values()) {
      const first = group[0];
      const letters = [...new Set(group.map(stop => stop.letter))].sort().join('/');
      const badge = node('span', letters, 'job-stop-badge');
      badge.dataset.stop = letters === 'A/B' ? 'both' : first.key;
      badge.classList.toggle('is-approximate', group.every(stop => stop.location.approximate));
      const title = group.length > 1 ? group.length + ' stops at this pin' : first.label + ' · ' + first.address;
      const marker = this.L.marker(first.location.point, {
        icon: this.L.divIcon({ className: 'job-location-marker', html: badge, iconSize: [34, 34], iconAnchor: [17, 17] }),
        title, alt: title,
      });
      const popup = node('div', undefined, 'job-map-popup');
      for (const stop of group) {
        const entry = node('div', undefined, 'job-map-popup-stop');
        entry.append(node('strong', [stop.job.jobNumber, stop.job.data.name || 'Customer'].filter(Boolean).join(' · ')),
          node('p', stop.label + ' · ' + stop.address));
        if (stop.location.approximate) entry.append(node('small', 'Approximate pin. Confirm the street address.'));
        const open = node('button', 'Open enquiry', 'quiet-button');
        open.type = 'button';
        open.addEventListener('click', () => this.openEnquiry(stop.job));
        entry.append(open);
        popup.append(entry);
      }
      marker.bindPopup(popup).addTo(this.pins);
      marker.getElement()?.setAttribute('aria-label', title);
    }
  }

  fitStops() {
    if (!this.pins?.getLayers().length) return;
    this.map.invalidateSize({ pan: false });
    this.map.fitBounds(this.pins.getBounds(), { padding: [42, 42], maxZoom: 12, animate: false });
  }

  async previewRoute() {
    if (!this.routeStops || this.routeRequest) return;
    if (this.routeVisible) {
      this.road.clearLayers();
      this.routeVisible = false;
      this.caption.textContent = '';
      this.routeButton.textContent = 'Preview route';
      this.fitStops();
      return;
    }
    const [from, to] = this.routeStops.map(stop => stop.location);
    const pickup = from.point.join(','), dropoff = to.point.join(',');
    const key = pickup + '|' + dropoff;
    const request = new AbortController();
    this.routeRequest = request;
    this.routeButton.disabled = true;
    this.caption.textContent = 'Finding the driving route…';
    try {
      let route = this.routeCache.get(key);
      if (!route) {
        const response = await fetch('/.netlify/functions/route-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pickup, dropoff }), signal: request.signal,
        });
        if (!response.ok) throw new Error('Route unavailable');
        route = await response.json();
        if (request.signal.aborted) return;
        if (!Number.isFinite(route.miles) || !Number.isFinite(route.minutes) ||
            !Array.isArray(route.path) || !route.path.length) throw new Error('Route unavailable');
        if (this.routeCache.size >= 20) this.routeCache.delete(this.routeCache.keys().next().value);
        this.routeCache.set(key, route);
      }
      const line = this.L.polyline(route.path, { color: '#1761bf', weight: 5 }).addTo(this.road);
      this.map.fitBounds(line.getBounds().extend(this.pins.getBounds()), { padding: [42, 42], animate: false });
      this.routeVisible = true;
      this.routeButton.textContent = 'Hide route';
      const hours = Math.floor(route.minutes / 60);
      const minutes = route.minutes % 60;
      const duration = hours ? hours + ' hr' + (minutes ? ' ' + minutes + ' min' : '') : minutes + ' min';
      this.caption.textContent = route.miles.toLocaleString('en-US') + ' mi · About ' + duration +
        (from.approximate || to.approximate ? ' · Approximate endpoints' : '');
    } catch {
      if (!request.signal.aborted) this.caption.textContent = 'Route preview unavailable. Open Google Maps for directions.';
    } finally {
      if (this.routeRequest === request) {
        this.routeRequest = undefined;
        this.routeButton.disabled = false;
      }
    }
  }
}
