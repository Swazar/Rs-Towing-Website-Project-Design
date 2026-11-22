const emailPattern = /^[a-z\d.!#$%&'*+/=^_`{|}~-]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/i;

/** @param {{ phone?: string, email?: string }} contact */
export function contactLinks({ phone, email }) {
  const number = String(phone || '').trim();
  const digits = number.replace(/\D/g, '');
  const dial = /^\+?[\d ().-]+$/.test(number) && digits.length >= 7 && digits.length <= 15
    ? (number.startsWith('+') ? '+' : '') + digits : '';
  const address = String(email || '').trim();
  const mail = address.length <= 254 && emailPattern.test(address)
    ? 'mailto:' + address.split('@').map(encodeURIComponent).join('@')
    : '';
  return { call: dial ? 'tel:' + dial : '', sms: dial ? 'sms:' + dial : '', mail };
}

export function priceInput(cents) {
  return Number.isSafeInteger(cents) && cents >= 0 ? (cents / 100).toFixed(2) : '';
}

export function priceLabel(cents) {
  return priceInput(cents) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100) : '';
}
