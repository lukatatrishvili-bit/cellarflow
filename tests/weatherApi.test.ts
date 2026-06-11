import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  localISODate,
  addDays,
  maxForecastDate,
  describeWeatherCode,
  fetchDayWeather,
} from '../lib/weatherApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('date helpers', () => {
  it('formats local dates as yyyy-mm-dd', () => {
    expect(localISODate(new Date(2026, 5, 11, 12))).toBe('2026-06-11');
    expect(localISODate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('caps forecasts at 15 days ahead', () => {
    expect(maxForecastDate()).toBe(addDays(localISODate(), 15));
  });
});

describe('describeWeatherCode', () => {
  it('maps key WMO codes', () => {
    expect(describeWeatherCode(0).label).toBe('Clear sky');
    expect(describeWeatherCode(3).label).toBe('Overcast');
    expect(describeWeatherCode(61).label).toBe('Rain');
    expect(describeWeatherCode(95).label).toBe('Thunderstorm');
  });

  it('falls back to the raw code for unknown values', () => {
    expect(describeWeatherCode(42).label).toBe('Code 42');
  });
});

describe('fetchDayWeather', () => {
  const stubFetch = () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return {
        ok: true,
        json: async () => ({
          timezone: 'Asia/Tbilisi',
          hourly: {
            time: ['2026-06-10T00:00', '2026-06-10T01:00'],
            temperature_2m: [18.4, 17.9],
            relative_humidity_2m: [80, 82],
            precipitation: [0, 0.3],
            wind_speed_10m: [5.5, 6.1],
          },
          daily: {
            weather_code: [61],
            temperature_2m_max: [30],
            temperature_2m_min: [10],
            precipitation_sum: [4.2],
            wind_speed_10m_max: [22.5],
          },
        }),
      };
    }));
    return calls;
  };

  it('rejects dates beyond the forecast horizon', async () => {
    await expect(fetchDayWeather(41.9, 45.5, addDays(localISODate(), 30))).rejects.toThrow(/15 days/);
  });

  it('routes historical dates to the archive API', async () => {
    const calls = stubFetch();
    const result = await fetchDayWeather(41.9, 45.5, '2024-09-15');
    expect(calls[0]).toContain('archive-api.open-meteo.com');
    expect(result.source).toBe('archive');
  });

  it('routes recent dates to the forecast API and requests current conditions for today', async () => {
    const calls = stubFetch();
    const result = await fetchDayWeather(41.9, 45.5, localISODate());
    expect(calls[0]).toContain('api.open-meteo.com/v1/forecast');
    expect(calls[0]).toContain('current=');
    expect(result.source).toBe('forecast');
  });

  it('parses hourly rows and computes GDD base 10', async () => {
    stubFetch();
    const result = await fetchDayWeather(41.9, 45.5, '2024-09-15');
    expect(result.hourly).toHaveLength(2);
    expect(result.hourly[0]).toEqual({ hour: '00', temp: 18.4, humidity: 80, precip: 0, wind: 5.5 });
    // GDD = (30 + 10) / 2 − 10 = 10
    expect(result.daily.gdd).toBe(10);
    expect(result.daily.code).toBe(61);
    expect(result.timezone).toBe('Asia/Tbilisi');
  });
});
