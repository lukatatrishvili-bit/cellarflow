import type { VineyardBlock } from './wineryState';

export interface VineyardMapPoint {
  lat: number;
  lng: number;
}

export type VineyardMapBounds = [[number, number], [number, number]];

const METERS_PER_LATITUDE_DEGREE = 111_320;
const MINIMUM_APPROXIMATE_AREA_HECTARES = 0.1;

export function isValidVineyardMapPoint(point: VineyardMapPoint | null | undefined): point is VineyardMapPoint {
  return Boolean(
    point
      && Number.isFinite(point.lat)
      && Number.isFinite(point.lng)
      && point.lat >= -90
      && point.lat <= 90
      && point.lng >= -180
      && point.lng <= 180,
  );
}

export function validBoundaryPoints(points: VineyardMapPoint[] | null | undefined): VineyardMapPoint[] {
  return (points || []).filter(isValidVineyardMapPoint);
}

export function hasUsableBoundary(points: VineyardMapPoint[] | null | undefined): boolean {
  return validBoundaryPoints(points).length >= 3;
}

/**
 * Return a block's recorded polygon. When cadastral/GPS geometry is absent,
 * create a small area-aware rectangle around its coordinate so the block is
 * still selectable without pretending the approximation is surveyed geometry.
 */
export function vineyardBlockBoundary(block: VineyardBlock): VineyardMapPoint[] {
  if (hasUsableBoundary(block.boundary)) return validBoundaryPoints(block.boundary);
  if (hasUsableBoundary(block.gpsPolygon)) return validBoundaryPoints(block.gpsPolygon);

  if (!isValidVineyardMapPoint({ lat: block.latitude, lng: block.longitude })) return [];

  const sideMeters = Math.sqrt(
    Math.max(block.area || 0, MINIMUM_APPROXIMATE_AREA_HECTARES) * 10_000,
  );
  const latOffset = sideMeters / 2 / METERS_PER_LATITUDE_DEGREE;
  const longitudeScale = Math.max(
    Math.cos((block.latitude * Math.PI) / 180),
    0.01,
  );
  const lngOffset = sideMeters / 2 / (METERS_PER_LATITUDE_DEGREE * longitudeScale);

  return [
    { lat: block.latitude - latOffset, lng: block.longitude - lngOffset },
    { lat: block.latitude + latOffset, lng: block.longitude - lngOffset },
    { lat: block.latitude + latOffset, lng: block.longitude + lngOffset },
    { lat: block.latitude - latOffset, lng: block.longitude + lngOffset },
  ];
}

export function vineyardMapBounds(points: VineyardMapPoint[]): VineyardMapBounds | null {
  const valid = validBoundaryPoints(points);
  if (valid.length === 0) return null;

  let minLat = valid[0].lat;
  let maxLat = valid[0].lat;
  let minLng = valid[0].lng;
  let maxLng = valid[0].lng;

  for (const point of valid.slice(1)) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }

  return [[minLat, minLng], [maxLat, maxLng]];
}

export function vineyardBlocksBounds(blocks: VineyardBlock[]): VineyardMapBounds | null {
  return vineyardMapBounds(blocks.flatMap(vineyardBlockBoundary));
}

export function appendBoundaryPoint(
  points: VineyardMapPoint[],
  point: VineyardMapPoint,
): VineyardMapPoint[] {
  if (!isValidVineyardMapPoint(point)) return points;
  const duplicate = points.some(existing => (
    Math.abs(existing.lat - point.lat) < 0.0000001
    && Math.abs(existing.lng - point.lng) < 0.0000001
  ));
  return duplicate ? points : [...points, point];
}
