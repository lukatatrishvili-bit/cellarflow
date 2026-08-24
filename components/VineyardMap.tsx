import React, { useEffect, useMemo, useState } from 'react';
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Language } from '../lib/i18n';
import type { VineyardBlock } from '../lib/wineryState';
import {
  hasUsableBoundary,
  isValidVineyardMapPoint,
  vineyardBlockBoundary,
  vineyardBlocksBounds,
  vineyardMapBounds,
  type VineyardMapPoint,
} from '../lib/vineyardMap';
import {
  VINEYARD_SATELLITE_BASEMAP,
  VINEYARD_SATELLITE_LABELS,
} from '../lib/vineyardBasemap';

interface VineyardMapProps {
  lang: Language;
  center: VineyardMapPoint;
  blocks?: VineyardBlock[];
  selectedBlockId?: string | null;
  onSelectBlock?: (blockId: string) => void;
  getBlockColor?: (blockId: string) => string;
  getBlockTooltipLines?: (blockId: string) => string[];
  drawing?: boolean;
  drawingPoints?: VineyardMapPoint[];
  onMapClick?: (point: VineyardMapPoint) => void;
  onRemoveDrawingPoint?: (index: number) => void;
  heightClassName?: string;
  ariaLabel?: string;
  showEmptyState?: boolean;
}

type ViewCommand = {
  type: 'estate' | 'selected';
  nonce: number;
};

function MapClickController({
  enabled,
  onMapClick,
}: {
  enabled: boolean;
  onMapClick?: (point: VineyardMapPoint) => void;
}) {
  useMapEvents({
    click(event) {
      if (enabled) onMapClick?.({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function MapViewportController({
  blocks,
  center,
  drawing,
  viewCommand,
  selectedBlockId,
}: {
  blocks: VineyardBlock[];
  center: VineyardMapPoint;
  drawing: boolean;
  viewCommand: ViewCommand | null;
  selectedBlockId?: string | null;
}) {
  const map = useMap();
  const bounds = useMemo(() => vineyardBlocksBounds(blocks), [blocks]);
  const centerLat = center.lat;
  const centerLng = center.lng;
  const centerIsValid = isValidVineyardMapPoint({ lat: centerLat, lng: centerLng });

  useEffect(() => {
    if (drawing || blocks.length === 0 || !bounds) return;
    map.fitBounds(bounds, { animate: false, maxZoom: 17, padding: [24, 24] });
  }, [blocks.length, bounds, drawing, map]);

  useEffect(() => {
    if ((!drawing && blocks.length > 0) || !centerIsValid) return;
    map.setView([centerLat, centerLng], map.getZoom(), { animate: false });
  }, [blocks.length, centerIsValid, centerLat, centerLng, drawing, map]);

  useEffect(() => {
    if (drawing || !viewCommand) return;
    if (viewCommand.type === 'estate' && bounds) {
      map.fitBounds(bounds, { animate: true, maxZoom: 17, padding: [24, 24] });
      return;
    }
    if (viewCommand.type !== 'selected' || !selectedBlockId) return;
    const selectedBlock = blocks.find(block => block.id === selectedBlockId);
    const selectedBounds = selectedBlock
      ? vineyardMapBounds(vineyardBlockBoundary(selectedBlock))
      : null;
    if (selectedBounds) {
      map.fitBounds(selectedBounds, { animate: true, maxZoom: 18, padding: [30, 30] });
    }
  }, [blocks, bounds, drawing, map, selectedBlockId, viewCommand]);

  return null;
}

/**
 * Leaflet measures its canvas only when it mounts. Dashboard cards can change
 * width without a window resize, so keep the canvas synchronized with its
 * actual card dimensions after organizer changes and responsive reflows.
 */
function MapResizeController() {
  const map = useMap();

  useEffect(() => {
    let frameId = 0;
    const invalidate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    };
    const container = map.getContainer();
    const observedElement = container.parentElement || container;
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(invalidate);

    observer?.observe(observedElement);
    window.addEventListener('resize', invalidate);
    invalidate();

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', invalidate);
      window.cancelAnimationFrame(frameId);
    };
  }, [map]);

  return null;
}

export default function VineyardMap({
  lang,
  center,
  blocks = [],
  selectedBlockId = null,
  onSelectBlock,
  getBlockColor,
  getBlockTooltipLines,
  drawing = false,
  drawingPoints = [],
  onMapClick,
  onRemoveDrawingPoint,
  heightClassName = 'h-full min-h-[160px]',
  ariaLabel,
  showEmptyState = true,
}: VineyardMapProps) {
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine
  ));
  const [tileError, setTileError] = useState(false);
  const [viewCommand, setViewCommand] = useState<ViewCommand | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const mapCenter: LatLngExpression = isValidVineyardMapPoint(center)
    ? [center.lat, center.lng]
    : [41.9056, 45.474];
  const validDrawingPoints = drawingPoints.filter(isValidVineyardMapPoint);
  const mapUnavailable = !isOnline || tileError;

  return (
    <div
      role="region"
      aria-label={ariaLabel || (lang === 'ka' ? 'ვენახის ინტერაქტიული რუკა' : 'Interactive vineyard map')}
      className={`relative z-0 isolate w-full overflow-hidden rounded-lg bg-stone-100 [contain:layout_paint] ${heightClassName} ${drawing ? 'vineyard-map--drawing' : ''}`}
      data-testid="vineyard-map"
    >
      <MapContainer
        center={mapCenter}
        zoom={15}
        scrollWheelZoom
        className="z-0 h-full w-full"
      >
        <TileLayer
          attribution={VINEYARD_SATELLITE_BASEMAP.attribution}
          url={VINEYARD_SATELLITE_BASEMAP.url}
          maxZoom={VINEYARD_SATELLITE_BASEMAP.maxZoom}
          eventHandlers={{
            tileerror: () => setTileError(true),
            tileload: () => setTileError(false),
          }}
        />
        <TileLayer
          url={VINEYARD_SATELLITE_LABELS.url}
          maxZoom={VINEYARD_SATELLITE_LABELS.maxZoom}
          zIndex={2}
        />

        <MapViewportController
          blocks={blocks}
          center={center}
          drawing={drawing}
          viewCommand={viewCommand}
          selectedBlockId={selectedBlockId}
        />
        <MapResizeController />
        <MapClickController enabled={Boolean(onMapClick)} onMapClick={onMapClick} />

        {blocks.map((block) => {
          const boundary = vineyardBlockBoundary(block);
          if (boundary.length < 3) return null;
          const selected = block.id === selectedBlockId;
          const isApproximate = !hasUsableBoundary(block.boundary) && !hasUsableBoundary(block.gpsPolygon);
          const tooltipLines = getBlockTooltipLines?.(block.id) || [];
          return (
            <Polygon
              key={block.id}
              positions={boundary.map(point => [point.lat, point.lng] as LatLngExpression)}
              pathOptions={{
                color: selected ? '#4e0e15' : '#57534e',
                fillColor: getBlockColor?.(block.id) || '#10b981',
                fillOpacity: selected ? 0.62 : 0.42,
                opacity: 0.95,
                weight: selected ? 4 : 2,
                dashArray: isApproximate ? '7 6' : undefined,
              }}
              eventHandlers={{
                click: () => onSelectBlock?.(block.id),
              }}
            >
              <Tooltip sticky>
                <strong>{block.name}</strong>
                <br />
                {block.grapeVariety} · {block.area.toLocaleString()} ha
                {tooltipLines.map(line => (
                  <React.Fragment key={line}>
                    <br />
                    <span>{line}</span>
                  </React.Fragment>
                ))}
                {isApproximate && (
                  <>
                    <br />
                    <span>{lang === 'ka' ? 'მიახლოებითი საზღვარი' : 'Approximate boundary'}</span>
                  </>
                )}
              </Tooltip>
            </Polygon>
          );
        })}

        {blocks.length === 0 && validDrawingPoints.length === 0 && (
          <CircleMarker
            center={mapCenter}
            radius={7}
            pathOptions={{ color: '#047857', fillColor: '#10b981', fillOpacity: 0.8 }}
          >
            <Tooltip permanent direction="top">
              {lang === 'ka' ? 'ნაკვეთის მდებარეობა' : 'Block location'}
            </Tooltip>
          </CircleMarker>
        )}

        {validDrawingPoints.length > 0 && validDrawingPoints.length < 3 && (
          <Polyline
            positions={validDrawingPoints.map(point => [point.lat, point.lng] as LatLngExpression)}
            pathOptions={{ color: '#047857', dashArray: '6 5', weight: 3 }}
          />
        )}

        {validDrawingPoints.length >= 3 && (
          <Polygon
            positions={validDrawingPoints.map(point => [point.lat, point.lng] as LatLngExpression)}
            pathOptions={{
              color: '#047857',
              fillColor: '#10b981',
              fillOpacity: 0.32,
              weight: 3,
            }}
            interactive={false}
          />
        )}

        {validDrawingPoints.map((point, index) => (
          <CircleMarker
            key={`${point.lat}-${point.lng}-${index}`}
            center={[point.lat, point.lng]}
            radius={9}
            pathOptions={{ color: '#ffffff', fillColor: '#047857', fillOpacity: 1, weight: 2 }}
            interactive={Boolean(onRemoveDrawingPoint)}
            bubblingMouseEvents={false}
            eventHandlers={onRemoveDrawingPoint
              ? { click: () => onRemoveDrawingPoint(index) }
              : undefined}
          >
            <Tooltip permanent direction="center" className="vineyard-map-point-label">
              {index + 1}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      {!drawing && blocks.length > 0 && (
        <div className="absolute right-3 top-3 z-[500] flex gap-1 rounded-lg border border-stone-200 bg-white/95 p-1 shadow-sm backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setViewCommand({ type: 'estate', nonce: Date.now() })}
            className="rounded px-2 py-1 text-[9px] font-bold text-stone-700 transition-colors hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-700"
          >
            {lang === 'ka' ? 'ყველა ნაკვეთი' : 'Fit estate'}
          </button>
          {selectedBlockId && (
            <button
              type="button"
              onClick={() => setViewCommand({ type: 'selected', nonce: Date.now() })}
              className="rounded bg-emerald-800 px-2 py-1 text-[9px] font-bold text-white transition-colors hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
            >
              {lang === 'ka' ? 'არჩეული' : 'Focus selected'}
            </button>
          )}
        </div>
      )}

      {drawing && validDrawingPoints.length > 0 && onRemoveDrawingPoint && (
        <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-lg border border-emerald-200 bg-white/95 px-2.5 py-1.5 text-[9px] font-semibold text-emerald-950 shadow-sm">
          {lang === 'ka'
            ? 'წერტილის წასაშლელად დააჭირეთ მის ნომერს'
            : 'Select a numbered vertex to remove it'}
        </div>
      )}

      {mapUnavailable && (
        <div className="pointer-events-none absolute left-3 top-3 z-[500] max-w-[15rem] rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 text-[10px] font-semibold leading-relaxed text-amber-900 shadow-sm backdrop-blur-sm">
          {lang === 'ka'
            ? 'საბაზო რუკა დროებით მიუწვდომელია. შენახული ნაკვეთის გეომეტრია კვლავ ჩანს.'
            : 'The base map is temporarily unavailable. Saved block geometry remains visible.'}
        </div>
      )}

      {showEmptyState && !drawing && blocks.length === 0 && validDrawingPoints.length === 0 && (
        <div className="pointer-events-none absolute bottom-7 left-1/2 z-[450] -translate-x-1/2 rounded-lg border border-stone-200 bg-white/95 px-3 py-1.5 text-center text-[10px] font-semibold text-stone-700 shadow-sm">
          {lang === 'ka' ? 'დაამატეთ პირველი ნაკვეთი რუკის შესავსებად.' : 'Add your first block to populate the map.'}
        </div>
      )}
    </div>
  );
}
