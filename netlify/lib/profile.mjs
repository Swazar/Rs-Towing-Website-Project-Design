import { text } from './validation.mjs';
import { preferenceDefaults, validTimeZone } from '../../public/assets/admin-preferences.js';
import { resolveWorkspace, validateWorkspace } from '../../public/assets/workspace-config.js';

export function validateProfile(body, previous = {}) {
  const displayName = text(body.displayName, 60, 'display name', true);
  const avatar = text(body.avatar ?? previous?.avatar ?? '', 110000, 'profile photo');
  const phone = text(body.phone ?? previous?.phone ?? '', 40, 'phone number');
  const jobTitle = text(body.jobTitle ?? previous?.jobTitle ?? '', 80, 'job title');
  const timeZone = body.timeZone ?? previous?.timeZone ?? preferenceDefaults.timeZone;
  const timeFormat = body.timeFormat ?? previous?.timeFormat ?? preferenceDefaults.timeFormat;
  if (!validTimeZone(timeZone)) throw Object.assign(new Error('Choose a valid timezone.'), { status: 400 });
  if (!['12h', '24h'].includes(timeFormat)) throw Object.assign(new Error('Choose a 12-hour or 24-hour clock.'), { status: 400 });
  if (avatar) {
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(avatar)) throw Object.assign(new Error('Upload a JPEG, PNG, or WebP photo using the photo picker.'), { status: 400 });
    const bytes = Buffer.from(avatar.split(',')[1], 'base64');
    if (bytes.length > 80000 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw Object.assign(new Error('Check the profile photo or choose a smaller image.'), { status: 400 });
  }
  // Sign-in email, account ID, and permissions never come from this form.
  const workspace = body.workspace === undefined ? resolveWorkspace(previous?.workspace) : validateWorkspace(body.workspace);
  return { displayName, avatar, phone, jobTitle, timeZone, timeFormat, workspace };
}
