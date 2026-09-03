export const VINEYARD_SATELLITE_BASEMAP = {
  url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: [
    'Imagery &copy; Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    'Reference data &copy; Esri, HERE, Garmin, OpenStreetMap contributors, and the GIS User Community',
  ].join(' · '),
  maxZoom: 20,
} as const;

export const VINEYARD_SATELLITE_LABELS = {
  url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  maxZoom: 20,
} as const;
