const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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
  let devicePickup;

  for (const field of fields) {
    const list = document.querySelector(`#${field.id}-suggestions`);
    const count = document.querySelector(`#${field.id}-suggestion-status`);
    let matches = [];
    let active = -1;
    let request = 0;

    field.setAttribute('role', 'combobox');
    field.setAttribute('aria-autocomplete', 'list');
    field.setAttribute('aria-controls', list.id);
    field.setAttribute('aria-expanded', 'false');

    function closeList() {
      request++;
      list.hidden = true;
      active = -1;
      count.textContent = '';
      field.setAttribute('aria-expanded', 'false');
      field.removeAttribute('aria-activedescendant');
    }

    function choose(index) {
      field.value = matches[index].label;
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

    field.addEventListener('input', async () => {
      if (field.value !== devicePickup?.label && field === fields[0]) devicePickup = undefined;
      closeList();
      const query = normalize(field.value);
      if (query.length < 2 || field !== document.activeElement ||
        field.value === devicePickup?.label || (field === fields[1] && query === 'unsure')) return;

      const current = request;
      try {
        const { entries, byName } = await loadCatalog();
        if (request !== current || byName.has(query)) return;
        matches = [];
        for (const place of entries) {
          if (place.key.startsWith(query)) matches.push(place);
          if (matches.length === 7) break;
        }
      } catch {
        if (request === current) count.textContent = 'City suggestions are temporarily unavailable.';
        return;
      }
      if (!matches.length) {
        count.textContent = 'No matching U.S. city. Try a nearby city.';
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
    return catalog?.byName.get(normalize(field.value));
  }

  return {
    prepare: () => loadCatalog().catch(() => {}),
    errorFor(field) {
      if (!fields.includes(field) || !field.value.trim() || find(field) ||
        (field === fields[1] && field.value.trim().toLowerCase() === 'unsure')) return '';
      return 'Enter a matching U.S. city and state.';
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
