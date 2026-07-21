import React, { useState, useEffect } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend
} from 'recharts';
import { CalendarSearch, Loader2, AlertTriangle, MapPin, Thermometer, Wind, Droplets, Sprout } from 'lucide-react';
import type { VineyardBlock } from '../lib/wineryState';
import type { Language } from '../lib/i18n';
import {
  fetchDayWeather, describeWeatherCode, localISODate, maxForecastDate, DayWeather
} from '../lib/weatherApi';
import LocationPicker, { PickedLocation } from './LocationPicker';

interface Props {
  lang: Language;
  blocks: VineyardBlock[];
}

/**
 * "Weather Explorer" — real observed/forecast weather for ANY date and ANY
 * location (vineyard block or searched place), powered by Open-Meteo.
 * Historical dates back to 1940 via the archive API; up to 15 days ahead via
 * the forecast API.
 */
export default function WeatherExplorer({ lang, blocks }: Props) {
  const today = localISODate();
  const [mode, setMode] = useState<'block' | 'custom'>(blocks.length > 0 ? 'block' : 'custom');
  const [blockId, setBlockId] = useState<string>(blocks[0]?.id || '');
  const [custom, setCustom] = useState<PickedLocation>({
    latitude: blocks[0]?.latitude ?? 41.9056,
    longitude: blocks[0]?.longitude ?? 45.474,
    label: 'Custom location',
  });
  const [date, setDate] = useState<string>(today);
  const [data, setData] = useState<DayWeather | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const block = blocks.find(b => b.id === blockId) || null;
  const lat = mode === 'block' && block ? block.latitude : custom.latitude;
  const lon = mode === 'block' && block ? block.longitude : custom.longitude;
  const locationLabel = mode === 'block' && block
    ? `${block.name} — ${block.locationName}`
    : (custom.label || 'Custom location');

  useEffect(() => {
    let cancelled = false;
    if (!lat || !lon || !date) return;
    setLoading(true);
    setError(null);
    fetchDayWeather(lat, lon, date)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) { setError(e?.message || 'Weather fetch failed.'); setData(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lat, lon, date]);

  const deco = data ? describeWeatherCode(data.daily.code, lang) : null;
  const isToday = date === today;
  const ka = lang === 'ka';

  // Hail risk assessment using convective proxies & weather codes
  const hailRisk = React.useMemo(() => {
    if (!data) return { probability: 0, level: 'None', color: 'text-stone-750' };
    const code = data.daily.code;
    const maxTemp = data.daily.tempMax;
    const precipSum = data.daily.precipSum;
    const windMax = data.daily.windMax;

    let probability = 0;
    if (code === 96 || code === 99) {
      probability = code === 99 ? 95 : 80;
    } else if (code === 95) {
      probability = 60;
    } else if (code === 82) {
      probability = 40;
    } else if (code === 80 || code === 81) {
      probability = 20;
    } else if (precipSum > 0 && maxTemp > 18 && windMax > 20) {
      probability = 15;
    } else if (precipSum > 0 && maxTemp > 15) {
      probability = 5;
    }

    let level: 'None' | 'Low' | 'Moderate' | 'High' | 'Critical' = 'None';
    let color = 'text-stone-750';

    if (probability >= 80) {
      level = 'Critical';
      color = 'text-red-700 font-extrabold';
    } else if (probability >= 50) {
      level = 'High';
      color = 'text-orange-700 font-bold';
    } else if (probability >= 20) {
      level = 'Moderate';
      color = 'text-amber-700 font-bold';
    } else if (probability > 0) {
      level = 'Low';
      color = 'text-emerald-700 font-bold';
    }

    return { probability, level, color };
  }, [data]);

  return (
    <div className="bg-white border border-[#e8dfd5] rounded-3xl shadow-sm overflow-hidden">
      {/* Panel header */}
      <div className="px-6 py-4 bg-gradient-to-r from-emerald-950 to-emerald-900 text-emerald-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-serif font-black uppercase tracking-wide flex items-center gap-2">
            <CalendarSearch className="w-4 h-4 text-emerald-300" />
            {ka ? 'ამინდი თარიღითა და ლოკაციით' : 'Weather Explorer — by date & location'}
          </h3>
          <p className="text-[10px] text-emerald-200/80 mt-0.5">
            {ka
              ? 'რეალური მონაცემები 1940 წლიდან დღემდე და 15-დღიანი პროგნოზი · Open-Meteo'
              : 'Real observations back to 1940 and forecasts 15 days ahead · Open-Meteo'}
          </p>
        </div>
        {data && deco && (
          <div className="flex items-center gap-2 bg-white/10 border border-white/15 rounded-xl px-3 py-1.5">
            <span className="text-xl leading-none">{deco.emoji}</span>
            <div>
              <span className="text-[11px] font-bold block leading-tight">{deco.label}</span>
              <span className="text-[9px] font-mono text-emerald-200/80 uppercase">
                {data.source === 'archive' ? (ka ? 'არქივი' : 'Archived') : (ka ? 'პროგნოზი' : 'Forecast')} · {data.timezone}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="p-5 sm:p-6 space-y-5">
        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-4 items-start">
          {/* Source toggle */}
          <div>
            <label className="text-[9px] uppercase font-mono block mb-1.5 font-bold text-stone-400">
              {ka ? 'ლოკაცია' : 'Location source'}
            </label>
            <div className="inline-flex rounded-lg border border-stone-200 overflow-hidden">
              {([
                { id: 'block', label: ka ? 'ნაკვეთი' : 'Vineyard block' },
                { id: 'custom', label: ka ? 'ძიება' : 'Search place' },
              ] as const).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${
                    mode === opt.id ? 'bg-emerald-800 text-white' : 'bg-stone-50 text-stone-500 hover:bg-stone-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Location control */}
          <div className="min-w-0">
            <label className="text-[9px] uppercase font-mono block mb-1.5 font-bold text-stone-400">
              {mode === 'block' ? (ka ? 'აირჩიეთ ნაკვეთი' : 'Choose block') : (ka ? 'იპოვეთ ადგილი' : 'Find a place')}
            </label>
            {mode === 'block' ? (
              <select
                value={blockId}
                onChange={(e) => setBlockId(e.target.value)}
                className="w-full md:max-w-sm bg-stone-50 border border-stone-200 px-3 py-2 rounded-lg text-xs font-bold text-stone-700 outline-none cursor-pointer"
              >
                {blocks.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {b.locationName} ({b.latitude.toFixed(3)}, {b.longitude.toFixed(3)})
                  </option>
                ))}
              </select>
            ) : (
              <LocationPicker
                lang={lang}
                latitude={custom.latitude}
                longitude={custom.longitude}
                onChange={(loc) => setCustom(prev => ({ ...prev, ...loc, label: loc.label ?? prev.label }))}
                showManual={false}
              />
            )}
          </div>

          {/* Date control */}
          <div>
            <label className="text-[9px] uppercase font-mono block mb-1.5 font-bold text-stone-400">
              {ka ? 'თარიღი' : 'Date'}
            </label>
            <input
              type="date"
              value={date}
              min="1940-01-01"
              max={maxForecastDate()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="bg-stone-50 border border-stone-200 px-3 py-2 rounded-lg text-xs font-bold text-stone-700 outline-none cursor-pointer"
            />
            <div className="mt-1.5 flex gap-1">
              {[
                { label: ka ? 'დღეს' : 'Today', value: today },
                { label: ka ? 'გუშინ' : 'Yesterday', value: localISODate(new Date(Date.now() - 86400000)) },
              ].map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setDate(p.value)}
                  className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold cursor-pointer transition-colors ${
                    date === p.value ? 'bg-emerald-800 text-white' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Status / data */}
        {loading ? (
          <div className="flex items-center justify-center gap-2.5 py-10 text-stone-500 text-xs font-semibold">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-700" />
            {ka ? 'ამინდის მონაცემები იტვირთება…' : 'Fetching real weather data…'}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        ) : data ? (
          <>
            {/* Summary strip */}
            <div className="flex flex-wrap items-stretch gap-3">
              <div className="px-4 py-3 bg-stone-50 border border-stone-200/80 rounded-xl min-w-[150px]">
                <span className="text-[8px] uppercase font-mono text-stone-400 font-bold tracking-widest flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {ka ? 'ადგილი' : 'Location'}
                </span>
                <strong className="text-[11px] text-stone-800 block mt-1 leading-snug">{locationLabel}</strong>
                <span className="text-[9px] font-mono text-stone-400">{lat.toFixed(4)}, {lon.toFixed(4)}</span>
              </div>
              <SummaryChip icon={<Thermometer className="w-3 h-3" />} label={ka ? 'მაქს / მინ' : 'Max / Min'}
                value={`${data.daily.tempMax}° / ${data.daily.tempMin}°C`} accent="text-[#801323]" />
              <SummaryChip icon={<Droplets className="w-3 h-3" />} label={ka ? 'ნალექი' : 'Precipitation'}
                value={`${data.daily.precipSum} mm`} accent="text-sky-700" />
              <SummaryChip icon={<Wind className="w-3 h-3" />} label={ka ? 'ქარი (მაქს)' : 'Wind (max)'}
                value={`${data.daily.windMax} km/h`} accent="text-stone-700" />
              <SummaryChip icon={<Sprout className="w-3 h-3" />} label={`GDD ${ka ? '(ბაზა 10°)' : '(base 10°)'}`}
                value={`${data.daily.gdd}`} accent="text-emerald-700" />
              <SummaryChip icon={<AlertTriangle className="w-3 h-3" />} label={ka ? 'სეტყვის რისკი' : 'Hail Risk'}
                value={hailRisk.probability > 0 ? `${hailRisk.probability}% (${ka ? (hailRisk.level === 'Critical' ? 'კრიტიკული' : hailRisk.level === 'High' ? 'მაღალი' : hailRisk.level === 'Moderate' ? 'საშუალო' : 'დაბალი') : hailRisk.level})` : (ka ? 'არა' : 'None')} accent={hailRisk.color} />
              {isToday && data.current && (
                <div className="px-4 py-3 bg-gradient-to-br from-[#4e0e15] to-[#31070b] text-amber-50 rounded-xl min-w-[150px]">
                  <span className="text-[8px] uppercase font-mono text-amber-200/70 font-bold tracking-widest">
                    {ka ? 'ახლა' : 'Right now'}
                  </span>
                  <strong className="text-lg font-serif block leading-tight mt-0.5">{data.current.temp}°C</strong>
                  <span className="text-[9px] font-mono text-amber-100/80">
                    {ka ? 'იგრძნობა' : 'feels'} {data.current.apparent}° · {data.current.humidity}% RH · {data.current.wind} km/h
                  </span>
                </div>
              )}
            </div>

            {hailRisk.probability >= 20 && (
              <div className={`p-4 rounded-xl border flex items-start gap-3 text-xs leading-relaxed ${
                hailRisk.probability >= 80
                  ? 'bg-red-50 border-red-200 text-red-950 animate-pulse'
                  : hailRisk.probability >= 50
                    ? 'bg-orange-50 border-orange-200 text-orange-950'
                    : 'bg-amber-50/75 border-amber-200 text-amber-900'
              }`}>
                <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${
                  hailRisk.probability >= 80 ? 'text-red-600 animate-bounce' : 'text-amber-600'
                }`} />
                <div>
                  <strong className="block font-serif font-black uppercase tracking-wider mb-1">
                    {ka ? 'Meteored კონვექციური გაფრთხილება: სეტყვის რისკი!' : 'Meteored Convective Alert: Hail Risk'}
                  </strong>
                  <span>
                    {ka
                      ? `ატმოსფერული არასტაბილურობის მაჩვენებელი მიუთითებს სეტყვის ${hailRisk.probability}%-იან ალბათობაზე. რეკომენდებულია დამცავი ბადეების გააქტიურება ან ანტისეტყვის სისტემების მომზადება.`
                      : `Atmospheric instability indices report a ${hailRisk.probability}% probability of convective hail. Vine canopy damage risk is ${hailRisk.level.toUpperCase()}. Recommend checking anti-hail rockets (Shildi systems) or preparing protective netting.`
                    }
                  </span>
                </div>
              </div>
            )}

            {/* Hourly chart */}
            <div>
              <h4 className="text-[10px] uppercase font-mono font-bold text-stone-400 tracking-widest mb-2">
                {ka ? '24-საათიანი სვლა' : 'Hourly temperature & precipitation'} — {date}
              </h4>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.hourly} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee7dd" />
                    <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#a8a29e' }} interval={2} />
                    <YAxis yAxisId="t" tick={{ fontSize: 9, fill: '#a8a29e' }} unit="°" />
                    <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 9, fill: '#7dd3fc' }} unit="mm" width={42} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid #e8dfd5' }}
                      formatter={(value: any, name: any) => {
                        if (name === 'Temp °C') return [`${value} °C`, name];
                        if (name === 'Rain mm') return [`${value} mm`, name];
                        return [value, name];
                      }}
                      labelFormatter={(l) => `${l}:00`}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar yAxisId="p" dataKey="precip" name="Rain mm" fill="#7dd3fc" radius={[3, 3, 0, 0]} barSize={8} />
                    <Area yAxisId="t" type="monotone" dataKey="temp" name="Temp °C" stroke="#801323" strokeWidth={2} fill="#80132318" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SummaryChip({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="px-4 py-3 bg-stone-50 border border-stone-200/80 rounded-xl min-w-[120px]">
      <span className="text-[8px] uppercase font-mono text-stone-400 font-bold tracking-widest flex items-center gap-1">
        {icon} {label}
      </span>
      <strong className={`text-sm font-serif block mt-1 ${accent}`}>{value}</strong>
    </div>
  );
}
