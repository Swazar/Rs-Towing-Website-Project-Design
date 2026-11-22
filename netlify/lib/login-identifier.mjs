const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Aliases stay server-side. Display names and user-editable metadata never grant access.
export function resolveLoginEmail(identifier, env = process.env) {
  if (typeof identifier !== 'string' || identifier.length > 254) return null;
  const value = identifier.trim();
  if (emailPattern.test(value)) return value;
  const alias = env.OWNER_LOGIN_USERNAME?.trim();
  const email = env.OWNER_LOGIN_EMAIL?.trim();
  if (alias && emailPattern.test(email || '') && value.toLowerCase() === alias.toLowerCase()) return email;
  return null;
}
