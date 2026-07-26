import type { VineyardBlock } from './wineryState';

export interface VineyardMapPoint {
  lat: number;
  lng: number;
}

export type VineyardMapBounds = [[number, number], [number, number]];
export type VineyardBoundaryValidationReason =
  | 'minimum-points'
  | 'self-intersection'
  | 'zero-area';

export interface VineyardBoundaryValidation {
  valid: boolean;
  areaHectares: number;
  reason?: VineyardBoundaryValidationReason;
}

export interface VineyardGeoJsonFeature {
  type: 'Feature';
  properties: {
    id: string;
    name: string;
    vineyardName: string;
    grapeVariety: string;
    registeredAreaHectares: number;
    measuredAreaHectares: number;
    boundarySource: 'boundary' | 'gpsPolygon' | 'approximate';
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

const METERS_PER_LATITUDE_DEGREE = 111_320;
const MINIMUM_APPROXIMATE_AREA_HECTARES = 0.1;
const EARTH_RADIUS_METERS = 6_371_008.8;
const MINIMUM_POLYGON_AREA_SQUARE_METERS = 1;

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
  return openBoundaryPoints(points || []).length >= 3;
}

function isSameMapPoint(first: VineyardMapPoint, second: VineyardMapPoint): boolean {
  return (
    Math.abs(first.lat - second.lat) < 0.0000001
    && Math.abs(first.lng - second.lng) < 0.0000001
  );
}

function openBoundaryPoints(points: VineyardMapPoint[]): VineyardMapPoint[] {
  const valid = validBoundaryPoints(points);
  if (valid.length > 1 && isSameMapPoint(valid[0], valid[valid.length - 1])) {
    return valid.slice(0, -1);
  }
  return valid;
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
  const duplicate = points.some(existing => isSameMapPoint(existing, point));
  return duplicate ? points : [...points, point];
}

export function removeBoundaryPoint(
  points: VineyardMapPoint[],
  index: number,
): VineyardMapPoint[] {
  if (!Number.isInteger(index) || index < 0 || index >= points.length) return points;
  return points.filter((_, pointIndex) => pointIndex !== index);
}

/**
 * Calculates polygon area on a local tangent plane. Vineyard blocks are small
 * enough for this projection to be more than adequate for field validation,
 * while keeping the result stable and dependency-free.
 */
export function vineyardPolygonAreaHectares(points: VineyardMapPoint[]): number {
  const valid = openBoundaryPoints(points);
  if (valid.length < 3) return 0;

  const referenceLatitudeRadians = (
    valid.reduce((sum, point) => sum + point.lat, 0) / valid.length
  ) * Math.PI / 180;
  const projected = valid.map(point => ({
    x: EARTH_RADIUS_METERS * point.lng * Math.PI / 180 * Math.cos(referenceLatitudeRadians),
    y: EARTH_RADIUS_METERS * point.lat * Math.PI / 180,
  }));

  let twiceArea = 0;
  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index];
    const next = projected[(index + 1) % projected.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }

  return Math.abs(twiceArea) / 2 / 10_000;
}

function orientation(a: VineyardMapPoint, b: VineyardMapPoint, c: VineyardMapPoint): number {
  const crossProduct = (
    (b.lng - a.lng) * (c.lat - a.lat)
    - (b.lat - a.lat) * (c.lng - a.lng)
  );
  if (Math.abs(crossProduct) < 1e-12) return 0;
  return crossProduct > 0 ? 1 : -1;
}

function pointOnSegment(a: VineyardMapPoint, b: VineyardMapPoint, point: VineyardMapPoint): boolean {
  return (
    point.lat <= Math.max(a.lat, b.lat) + 1e-12
    && point.lat >= Math.min(a.lat, b.lat) - 1e-12
    && point.lng <= Math.max(a.lng, b.lng) + 1e-12
    && point.lng >= Math.min(a.lng, b.lng) - 1e-12
  );
}

function segmentsIntersect(
  firstStart: VineyardMapPoint,
  firstEnd: VineyardMapPoint,
  secondStart: VineyardMapPoint,
  secondEnd: VineyardMapPoint,
): boolean {
  const firstToSecondStart = orientation(firstStart, firstEnd, secondStart);
  const firstToSecondEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondToFirstStart = orientation(secondStart, secondEnd, firstStart);
  const secondToFirstEnd = orientation(secondStart, secondEnd, firstEnd);

  if (
    firstToSecondStart !== firstToSecondEnd
    && secondToFirstStart !== secondToFirstEnd
  ) return true;

  if (firstToSecondStart === 0 && pointOnSegment(firstStart, firstEnd, secondStart)) return true;
  if (firstToSecondEnd === 0 && pointOnSegment(firstStart, firstEnd, secondEnd)) return true;
  if (secondToFirstStart === 0 && pointOnSegment(secondStart, secondEnd, firstStart)) return true;
  if (secondToFirstEnd === 0 && pointOnSegment(secondStart, secondEnd, firstEnd)) return true;
  return false;
}

export function vineyardBoundarySelfIntersects(points: VineyardMapPoint[]): boolean {
  const valid = openBoundaryPoints(points);
  if (valid.length < 4) return false;

  for (let firstIndex = 0; firstIndex < valid.length; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % valid.length;
    for (let secondIndex = firstIndex + 1; secondIndex < valid.length; secondIndex += 1) {
      const secondNext = (secondIndex + 1) % valid.length;
      const edgesAreAdjacent = (
        firstIndex === secondIndex
        || firstNext === secondIndex
        || secondNext === firstIndex
      );
      if (edgesAreAdjacent) continue;
      if (segmentsIntersect(
        valid[firstIndex],
        valid[firstNext],
        valid[secondIndex],
        valid[secondNext],
      )) return true;
    }
  }
  return false;
}

export function validateVineyardBoundary(points: VineyardMapPoint[]): VineyardBoundaryValidation {
  const valid = openBoundaryPoints(points);
  const areaHectares = vineyardPolygonAreaHectares(valid);
  if (valid.length < 3) {
    return { valid: false, areaHectares, reason: 'minimum-points' };
  }
  if (vineyardBoundarySelfIntersects(valid)) {
    return { valid: false, areaHectares, reason: 'self-intersection' };
  }
  if (areaHectares * 10_000 < MINIMUM_POLYGON_AREA_SQUARE_METERS) {
    return { valid: false, areaHectares, reason: 'zero-area' };
  }
  return { valid: true, areaHectares };
}

export function vineyardBlockGeoJsonFeature(block: VineyardBlock): VineyardGeoJsonFeature {
  const boundarySource = hasUsableBoundary(block.boundary)
    ? 'boundary'
    : hasUsableBoundary(block.gpsPolygon)
      ? 'gpsPolygon'
      : 'approximate';
  const boundary = openBoundaryPoints(vineyardBlockBoundary(block));
  const coordinates = boundary.map(point => [point.lng, point.lat]);
  if (coordinates.length > 0) coordinates.push([...coordinates[0]]);

  return {
    type: 'Feature',
    properties: {
      id: block.id,
      name: block.name,
      vineyardName: block.vineyardName,
      grapeVariety: block.grapeVariety,
      registeredAreaHectares: block.area,
      measuredAreaHectares: vineyardPolygonAreaHectares(boundary),
      boundarySource,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates],
    },
  };
}
