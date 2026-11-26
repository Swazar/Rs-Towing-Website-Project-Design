const freightPhoto = { src: '/assets/flatbed-freight.webp', smallSrc: '/assets/flatbed-freight-small.webp', smallWidth: 480, width: 900, height: 600, alt: 'Blue-wrapped cargo strapped onto a flatbed trailer at a warehouse', position: 'center' };
export const originalImages = {
  hero: { src: '/assets/hauling-hero.webp', smallSrc: '/assets/hauling-hero-small.webp', width: 1280, height: 720, smallWidth: 640, alt: 'RS on the Go pickup hitched to a loaded equipment trailer', position: 'right' },
  contact: freightPhoto,
  gallery0: { src: '/assets/equipment-transport.webp', smallSrc: '/assets/equipment-transport-small.webp', smallWidth: 480, width: 1100, height: 619, alt: 'Tanks and equipment secured on a trailer behind the RS on the Go pickup', position: 'center' },
  gallery1: freightPhoto,
};
export const imagePositions = { center: 'Center', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' };
export const mediaIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function mediaSrc(id) { return '/.netlify/functions/site-image?id=' + id; }
export function imageId(src) {
  const id = String(src).match(/^\/\.netlify\/functions\/site-image\?id=([0-9a-f-]+)$/)?.[1];
  return id && mediaIdPattern.test(id) ? id : null;
}
export function builtinImage(src) { return Object.values(originalImages).find(image => image.src === src); }
export function withMediaDefaults(settings) {
  const resolve = (image, fallback) => image?.src ? { ...builtinImage(image.src), ...image } : { ...fallback };
  return { ...settings, heroImage: resolve(settings.heroImage, originalImages.hero), contactImage: resolve(settings.contactImage, originalImages.contact),
    gallery: settings.gallery.map((photo, index) => ({ ...resolve(photo, originalImages['gallery' + index]), ...photo })) };
}
export function settingsImages(settings) { return [settings?.heroImage, settings?.contactImage, ...(settings?.gallery || [])].filter(Boolean); }
export function imageIsPublished(id, settings) { return settingsImages(settings).some(image => imageId(image.src) === id); }
export function applyImage(element, definition, sizes = '(max-width: 760px) calc(100vw - 36px), 640px') {
  if (!element || !definition) return;
  element.alt = definition.alt || '';
  element.style.objectPosition = Object.hasOwn(imagePositions, definition.position) ? definition.position : 'center';
  if (definition.smallSrc && definition.smallWidth && definition.width > definition.smallWidth) {
    element.sizes = sizes;
    element.srcset = `${definition.smallSrc} ${definition.smallWidth}w, ${definition.src} ${definition.width}w`;
  } else { element.removeAttribute('srcset'); element.removeAttribute('sizes'); }
  element.src = definition.src;
  if (definition.width && definition.height) { element.width = definition.width; element.height = definition.height; }
}
