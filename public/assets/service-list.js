// Move the existing service content so live edits and quote shortcuts keep working.
export function adaptServiceList(list) {
  if (!list) return;
  const document = list.ownerDocument;
  const rows = list.querySelectorAll('.service-row');
  const compact = document.defaultView.matchMedia('(max-width: 600px)');

  function update() {
    for (const row of rows) {
      const heading = row.querySelector('h3');
      const details = row.querySelector('details');
      if (compact.matches && !details) {
        const disclosure = document.createElement('details');
        const summary = document.createElement('summary');
        const focused = row.contains(document.activeElement) ? document.activeElement : null;
        summary.append(heading);
        disclosure.append(summary, ...row.children);
        row.append(disclosure);
        if (focused) {
          disclosure.open = true;
          focused.focus({ preventScroll: true });
        }
      } else if (!compact.matches && details) {
        const focused = details.contains(document.activeElement) ? document.activeElement : null;
        const summary = details.querySelector('summary');
        row.append(heading);
        summary.remove();
        row.append(...details.children);
        details.remove();
        if (focused === summary) heading.tabIndex = -1;
        (focused === summary ? heading : focused)?.focus({ preventScroll: true });
      }
    }
  }

  update();
  compact.addEventListener('change', update);
}
