declare const L: any;

let patched = false;

/**
 * Leaflet's default marker icon images are referenced by leaflet.css via a
 * relative path that assumes its own dist/images folder sits next to it —
 * that breaks once the CSS is bundled by Angular. The images are copied to
 * /leaflet/images via angular.json assets; point Leaflet's default icon at
 * them. Call once before creating any L.marker(...) without an explicit icon.
 */
export function patchLeafletDefaultIcon(): void {
  if (patched || typeof L === 'undefined') return;
  L.Icon.Default.mergeOptions({
    iconUrl: 'leaflet/images/marker-icon.png',
    iconRetinaUrl: 'leaflet/images/marker-icon-2x.png',
    shadowUrl: 'leaflet/images/marker-shadow.png',
  });
  patched = true;
}
