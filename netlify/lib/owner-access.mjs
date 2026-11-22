const ownerPermissions = ['jobs', 'content', 'reviews', 'export', 'activity', 'email'];
export function permissionsFor(user) {
  if (user?.roles?.includes('owner')) return [...ownerPermissions];
  if (user?.roles?.includes('staff')) return ['jobs'];
  return [];
}

export function canUseAction(user, action, method) {
  const permissions = permissionsFor(user);
  if (!permissions.length) return false;
  if (['session', 'profile', 'list'].includes(action)) return true;
  if (['enquiry', 'reminder'].includes(action)) return permissions.includes('jobs');
  if (action === 'content') return method === 'GET' || permissions.includes('content');
  if (action === 'review') return permissions.includes('reviews');
  if (action === 'export') return permissions.includes('export');
  if (action === 'versions') return permissions.includes('content');
  return false;
}

export function addHistory(previous, actor, action, subject) {
  return [{ id: crypto.randomUUID(), at: new Date().toISOString(), actor: actor.email, action, subject }, ...(previous?.history || [])].slice(0, 50);
}
