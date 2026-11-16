const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const startsWithStreetNumber = value => /^\d+\w*[-\d]*\s+\S/.test(value);

let catalog;
let catalogRequest;
let boundaryRequest;

async function readData(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Location data unavailable');
  return response.json();
}

function loadCatalog() {
  catalogRequest ??= readData('/assets/us-places.json').then(rows => {
    const entries = rows.map(([label, lat, lng]) => ({ label, key: normalize(label), point: [lat, lng] }));
    catalog = { entries, byName: new Map(entries.map(place => [place.key, place])) };
    return catalog;
  }).catch(error => {
    catalogRequest = undefined;
    throw error;
  });
  return catalogRequest;
}

function insideRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export function withinUsBoundary(lat, lng, polygons) {
  return polygons.some(([outer, ...holes]) =>
    insideRing(lng, lat, outer) && !holes.some(hole => insideRing(lng, lat, hole)));
}

export function addLocationSuggestions(form) {
  const fields = [form.elements.pickup, form.elements.dropoff];
  const selectedAddresses = new Map();
  let devicePickup;

  for (const field of fields) {
    const list = document.querySelector(`#${field.id}-suggestions`);
    const count = document.querySelector(`#${field.id}-suggestion-status`);
    let matches = [];
    let active = -1;
    let request = 0;
    let lookupTimer;
    let addressLookup;

    field.setAttribute('role', 'combobox');
    field.setAttribute('aria-autocomplete', 'list');
    field.setAttribute('aria-controls', list.id);
    field.setAttribute('aria-expanded', 'false');

    function closeList() {
      request++;
      clearTimeout(lookupTimer);
      addressLookup?.abort();
      list.hidden = true;
      active = -1;
      count.textContent = '';
      field.setAttribute('aria-expanded', 'false');
      field.removeAttribute('aria-activedescendant');
    }

    function choose(index) {
      const place = matches[index];
      field.value = place.label;
      if (!place.key) selectedAddresses.set(field, place);
      closeList();
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function highlight(index) {
      active = index;
      [...list.children].forEach((option, i) => option.setAttribute('aria-selected', i === active));
      const option = list.children[active];
      field.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    }

    function showMatches(places, emptyMessage) {
      matches = places;
      if (!matches.length) {
        count.textContent = emptyMessage;
        return;
      }
      list.replaceChildren(...matches.map(({ label }, index) => {
        const option = document.createElement('li');
        option.id = `${list.id}-${index}`;
        option.dataset.index = index;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.textContent = label;
        return option;
      }));
      list.hidden = false;
      field.setAttribute('aria-expanded', 'true');
      count.textContent = `${matches.length} U.S. locations available.`;
    }

    async function suggestAddresses(query, current) {
      addressLookup = new AbortController();
      try {
        const response = await fetch('/.netlify/functions/address-suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
          signal: addressLookup.signal,
        });
        if (!response.ok) throw new Error('Address suggestions unavailable');
        const places = await response.json();
        if (request === current) showMatches(places, 'No matching street address. Try adding the city or ZIP code.');
      } catch {
        if (request === current) count.textContent = 'Address suggestions are temporarily unavailable. Try a city and state.';
      }
    }

    field.addEventListener('input', async () => {
      if (field.value !== devicePickup?.label && field === fields[0]) devicePickup = undefined;
      if (field.value !== selectedAddresses.get(field)?.label) selectedAddresses.delete(field);
      closeList();
      const text = field.value.trim();
      const query = normalize(text);
      if (query.length < 2 || field !== document.activeElement || selectedAddresses.has(field) ||
        field.value === devicePickup?.label || (field === fields[1] && query === 'unsure')) return;

      const current = request;
      if (startsWithStreetNumber(text)) {
        if (text.length >= 5) lookupTimer = setTimeout(() => suggestAddresses(text, current), 350);
        return;
      }

      try {
        const { entries, byName } = await loadCatalog();
        if (request !== current || byName.has(query)) return;
        const places = [];
        for (const place of entries) {
          if (place.key.startsWith(query)) places.push(place);
          if (places.length === 7) break;
        }
        showMatches(places, 'No matching U.S. city. Try a nearby city.');
      } catch {
        if (request === current) count.textContent = 'City suggestions are temporarily unavailable.';
      }
    });

    field.addEventListener('keydown', event => {
      if (list.hidden) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = active < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
          : (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        highlight(next);
      } else if (event.key === 'Enter' && active >= 0) {
        event.preventDefault();
        choose(active);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeList();
      }
    });

    list.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') event.preventDefault();
    });
    list.addEventListener('click', event => {
      const option = event.target.closest('[role="option"]');
      if (option) choose(Number(option.dataset.index));
    });
    field.addEventListener('blur', () => setTimeout(() => {
      if (document.activeElement !== field) closeList();
    }, 180));
  }

  function find(field) {
    if (field === fields[0] && field.value === devicePickup?.label) return devicePickup;
    const address = selectedAddresses.get(field);
    if (field.value === address?.label) return address;
    return catalog?.byName.get(normalize(field.value));
  }

  return {
    prepare: () => loadCatalog().catch(() => {}),
    errorFor(field) {
      if (!fields.includes(field) || !field.value.trim() || find(field) ||
        (field === fields[1] && field.value.trim().toLowerCase() === 'unsure')) return '';
      return 'Choose a U.S. street address from the suggestions, or enter a matching city and state.';
    },
    pointFor(field) {
      return find(field)?.point;
    },
    async useDevicePickup(lat, lng, expectedValue) {
      boundaryRequest ??= readData('/assets/us-boundary.json').catch(error => {
        boundaryRequest = undefined;
        throw error;
      });
      const polygons = await boundaryRequest;
      if (fields[0].value !== expectedValue) return;
      if (!withinUsBoundary(lat, lng, polygons)) return false;
      const label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      devicePickup = { label, point: [lat, lng] };
      fields[0].value = label;
      fields[0].dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
  };
}
