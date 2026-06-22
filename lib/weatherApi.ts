/**
 * Real weather data via Open-Meteo (https://open-meteo.com) — free, no API key.
 *
 * - Geocoding:  geocoding-api.open-meteo.com  (place name -> coordinates)
 * - Forecast:   api.open-meteo.com            (today ±, up to 15 days ahead, ~92 days back)
 * - Archive:    archive-api.open-meteo.com    (historical, back to 1940)
 *
 * `fetchDayWeather` routes to the right endpoint for the requested date so the
 * UI can ask for any date with one call.
 */

export interface GeoLocation {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  elevation?: number;
}

export interface DayWeather {
  date: string;
  source: 'forecast' | 'archive';
  timezone: string;
  /** Present only when the requested date is today (forecast endpoint). */
  current?: {
    temp: number;
    apparent: number;
    humidity: number;
    precip: number;
    wind: number;
    code: number;
  };
  hourly: Array<{
    hour: string; // "00" .. "23" local time
    temp: number;
    humidity: number;
    precip: number;
    wind: number;
  }>;
  daily: {
    code: number;
    tempMax: number;
    tempMin: number;
    precipSum: number;
    windMax: number;
    /** Growing Degree Days for the date, base 10 °C. */
    gdd: number;
  };
}

/** Local (not UTC-shifted) yyyy-mm-dd. */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localISODate(d);
}

/** Latest date the forecast endpoint can serve (15 days ahead). */
export function maxForecastDate(): string {
  return addDays(localISODate(), 15);
}

export async function searchLocations(query: string): Promise<GeoLocation[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const json = await res.json();
  return (json.results || []).map((r: any) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    admin1: r.admin1,
    elevation: r.elevation,
  }));
}

const HOURLY_FIELDS = 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m';
const DAILY_FIELDS = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max';

export async function fetchDayWeather(lat: number, lon: number, dateISO: string): Promise<DayWeather> {
  const today = localISODate();
  if (dateISO > maxForecastDate()) {
    throw new Error('Forecasts are only available up to 15 days ahead.');
  }

  // Forecast endpoint covers roughly the last 92 days; older dates use the archive.
  const useArchive = dateISO < addDays(today, -90);
  const base = useArchive
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: dateISO,
    end_date: dateISO,
    hourly: HOURLY_FIELDS,
    daily: DAILY_FIELDS,
    timezone: 'auto',
  });
  if (!useArchive && dateISO === today) {
    params.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m');
  }

  const res = await fetch(`${base}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.reason || `Weather request failed (${res.status})`);
  }
  const json = await res.json();

  const h = json.hourly || {};
  const times: string[] = h.time || [];
  const hourly = times.map((tIso, i) => ({
    hour: tIso.slice(11, 13),
    temp: round1(h.temperature_2m?.[i]),
    humidity: Math.round(h.relative_humidity_2m?.[i] ?? 0),
    precip: round1(h.precipitation?.[i]),
    wind: round1(h.wind_speed_10m?.[i]),
  }));

  const d = json.daily || {};
  const tempMax = round1(d.temperature_2m_max?.[0]);
  const tempMin = round1(d.temperature_2m_min?.[0]);

  const result: DayWeather = {
    date: dateISO,
    source: useArchive ? 'archive' : 'forecast',
    timezone: json.timezone || 'auto',
    hourly,
    daily: {
      code: d.weather_code?.[0] ?? 0,
      tempMax,
      tempMin,
      precipSum: round1(d.precipitation_sum?.[0]),
      windMax: round1(d.wind_speed_10m_max?.[0]),
      gdd: Math.max(0, round1((tempMax + tempMin) / 2 - 10)),
    },
  };

  if (json.current) {
    result.current = {
      temp: round1(json.current.temperature_2m),
      apparent: round1(json.current.apparent_temperature),
      humidity: Math.round(json.current.relative_humidity_2m ?? 0),
      precip: round1(json.current.precipitation),
      wind: round1(json.current.wind_speed_10m),
      code: json.current.weather_code ?? 0,
    };
  }

  return result;
}

function round1(n: unknown): number {
  const v = typeof n === 'number' ? n : 0;
  return Math.round(v * 10) / 10;
}

/** WMO weather interpretation codes -> compact description. */
export function describeWeatherCode(code: number, lang: string = 'en'): { emoji: string; label: string } {
  const isKa = lang === 'ka';
  if (code === 0) return { emoji: '☀️', label: isKa ? 'მოწმენდილი ცა' : 'Clear sky' };
  if (code === 1) return { emoji: '🌤️', label: isKa ? 'უმეტესად მოწმენდილი' : 'Mainly clear' };
  if (code === 2) return { emoji: '⛅', label: isKa ? 'ნაწილობრივ ღრუბლიანი' : 'Partly cloudy' };
  if (code === 3) return { emoji: '☁️', label: isKa ? 'მოღრუბლული' : 'Overcast' };
  if (code === 45 || code === 48) return { emoji: '🌫️', label: isKa ? 'ნისლი' : 'Fog' };
  if (code >= 51 && code <= 57) return { emoji: '🌦️', label: isKa ? 'ჟინჟღლი' : 'Drizzle' };
  if (code >= 61 && code <= 67) return { emoji: '🌧️', label: isKa ? 'წვიმა' : 'Rain' };
  if (code >= 71 && code <= 77) return { emoji: '🌨️', label: isKa ? 'თოვლი' : 'Snow' };
  if (code >= 80 && code <= 82) return { emoji: '🌧️', label: isKa ? 'ძლიერი წვიმა' : 'Rain showers' };
  if (code === 85 || code === 86) return { emoji: '🌨️', label: isKa ? 'ძლიერი თოვლი' : 'Snow showers' };
  if (code === 95) return { emoji: '⛈️', label: isKa ? 'ჭექა-ქუხილი' : 'Thunderstorm' };
  if (code === 96 || code === 99) return { emoji: '⛈️', label: isKa ? 'ჭექა-ქუხილი სეტყვით' : 'Thunderstorm w/ hail' };
  return { emoji: '🌡️', label: isKa ? `კოდი ${code}` : `Code ${code}` };
}
