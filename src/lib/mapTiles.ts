/** Free OSM raster tiles — no API key required. */
export const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export const OSM_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Default center matches seed fleet (San Francisco). */
export const DEFAULT_MAP_CENTER: [number, number] = [37.7749, -122.4194];
export const DEFAULT_MAP_ZOOM = 13;
