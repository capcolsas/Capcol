const LEAFLET_CSS_URLS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'
];
const LEAFLET_JS_URLS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'
];
const LEAFLET_CSS_ID = 'leaflet-css';
let leafletPromise = null;

export function parseCoordinate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function hasValidSedeLocation(lat, lng) {
  const latitude = parseCoordinate(lat);
  const longitude = parseCoordinate(lng);
  return latitude !== null && latitude >= -90 && latitude <= 90
    && longitude !== null && longitude >= -180 && longitude <= 180
    && !isNullIslandLocation(latitude, longitude);
}

export function sedeCoordinates(sede = {}) {
  const latitude = parseCoordinate(sede.qrLatitude);
  const longitude = parseCoordinate(sede.qrLongitude);
  if (!hasValidSedeLocation(latitude, longitude)) return null;
  return { latitude, longitude };
}

export function sedeLocationLabel(sede = {}) {
  const coords = sedeCoordinates(sede);
  if (!coords) return '-';
  const radius = Number(sede.qrRadiusMeters || 500);
  const radiusLabel = Number.isFinite(radius) && radius > 0 ? ` (${Math.round(radius)} m)` : '';
  return `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}${radiusLabel}`;
}

export function googleMapsDirectionsUrl(lat, lng) {
  if (!hasValidSedeLocation(lat, lng)) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${Number(lat)},${Number(lng)}`)}&travelmode=driving`;
}

export function wazeDirectionsUrl(lat, lng) {
  if (!hasValidSedeLocation(lat, lng)) return '';
  return `https://waze.com/ul?ll=${encodeURIComponent(`${Number(lat)},${Number(lng)}`)}&navigate=yes`;
}

export async function ensureLeaflet() {
  if (globalThis.L?.map) return globalThis.L;
  if (!leafletPromise) {
    leafletPromise = loadLeafletFrom(0);
  }
  return leafletPromise;
}

function isNullIslandLocation(latitude, longitude) {
  return Math.abs(Number(latitude || 0)) < 0.000001 && Math.abs(Number(longitude || 0)) < 0.000001;
}

function loadLeafletFrom(index) {
  return new Promise((resolve, reject) => {
    ensureLeafletStyles(index);
    const src = LEAFLET_JS_URLS[index];
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(globalThis.L));
      existing.addEventListener('error', () => {
        if (index + 1 < LEAFLET_JS_URLS.length) loadLeafletFrom(index + 1).then(resolve).catch(reject);
        else reject(new Error('No se pudo cargar Leaflet.'));
      });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = '';
    script.addEventListener('load', () => {
      if (globalThis.L?.map) resolve(globalThis.L);
      else if (index + 1 < LEAFLET_JS_URLS.length) loadLeafletFrom(index + 1).then(resolve).catch(reject);
      else reject(new Error('Leaflet no quedo disponible.'));
    });
    script.addEventListener('error', () => {
      if (index + 1 < LEAFLET_JS_URLS.length) loadLeafletFrom(index + 1).then(resolve).catch(reject);
      else reject(new Error('No se pudo cargar Leaflet.'));
    });
    document.head.appendChild(script);
  });
}

function ensureLeafletStyles() {
  if (document.getElementById(LEAFLET_CSS_ID)) return;
  const link = document.createElement('link');
  link.id = LEAFLET_CSS_ID;
  link.rel = 'stylesheet';
  link.href = LEAFLET_CSS_URLS[0];
  link.crossOrigin = '';
  document.head.appendChild(link);
}
