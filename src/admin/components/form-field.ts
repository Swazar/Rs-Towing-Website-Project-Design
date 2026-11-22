import { node } from '../../../public/assets/admin-ui.js';

export function formField(label: string, name: string, value = '', type = 'text', maxLength?: number) {
  const wrapper = node('div', undefined, 'field');
  const caption = node('label', label);
  const input = type === 'textarea' ? node('textarea') : node('input');
  input.id = 'owner-field-' + name;
  input.name = name;
  input.value = value;
  if (input.tagName === 'INPUT') (input as HTMLInputElement).type = type;
  if (maxLength) input.maxLength = maxLength;
  caption.htmlFor = input.id;
  wrapper.append(caption, input);
  return { wrapper, input };
}
