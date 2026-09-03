import React, { useState } from 'react';
import { Search, MapPin, Loader2, AlertTriangle } from 'lucide-react';
import { searchLocations, GeoLocation } from '../lib/weatherApi';

export interface PickedLocation {
  latitude: number;
  longitude: number;
  label?: string;
  elevation?: number;
}

interface Props {
  latitude: number;
  longitude: number;
  onChange: (loc: PickedLocation) => void;
  /** Render manual lat/lon inputs (omit when the host form already has them). */
  showManual?: boolean;
  placeholder?: string;
  /** UI language; only 'ka' has translations. */
  lang?: string;
}

/**
 * Place-name search via the free Open-Meteo geocoder (no API key), with
 * optional manual coordinate entry. Used by vineyard block registration and
 * the Weather Explorer.
 */
export default function LocationPicker({ latitude, longitude, onChange, showManual = true, placeholder, lang = 'en' }: Props) {
  const isKa = lang === 'ka';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async () => {
    if (query.trim().length < 2 || searching) return;
    setSearching(true);
    setError(null);
    try {
      const found = await searchLocations(query);
      setResults(found);
      if (found.length === 0) setError(isKa ? 'ადგილი ვერ მოიძებნა — სცადეთ სხვა დაწერილობა.' : 'No places found — try another spelling.');
    } catch (e: any) {
      setError(e?.message || (isKa ? 'ძებნა ვერ შესრულდა. შეამოწმეთ კავშირი.' : 'Search failed. Check your connection.'));
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const pick = (r: GeoLocation) => {
    onChange({
      latitude: r.latitude,
      longitude: r.longitude,
      elevation: r.elevation,
      label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    });
    setResults([]);
    setQuery([r.name, r.country].filter(Boolean).join(', '));
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder={placeholder || (isKa ? 'მოძებნეთ ადგილი… მაგ. თელავი, ბორდო' : 'Search a place… e.g. Telavi, Bordeaux')}
            className="w-full bg-stone-50 border border-stone-200 rounded-lg pl-8 pr-2 py-2 text-xs text-stone-900 font-medium outline-none focus:border-emerald-600 transition-colors"
          />
        </div>
        <button
          type="button"
          onClick={runSearch}
          disabled={searching || query.trim().length < 2}
          className="px-3 py-2 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white rounded-lg text-[10px] font-mono font-bold uppercase tracking-wide cursor-pointer transition-colors flex items-center gap-1.5"
        >
          {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
          {isKa ? 'ძებნა' : 'Find'}
        </button>
      </div>

      {error && (
        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0" /> {error}
        </p>
      )}

      {results.length > 0 && (
        <ul className="border border-stone-200 rounded-lg divide-y divide-stone-100 overflow-hidden bg-white shadow-sm max-h-44 overflow-y-auto">
          {results.map((r, i) => (
            <li key={`${r.latitude}-${r.longitude}-${i}`}>
              <button
                type="button"
                onClick={() => pick(r)}
                className="w-full text-left px-3 py-2 hover:bg-emerald-50/60 transition-colors flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="min-w-0">
                  <span className="text-[11px] font-bold text-stone-800 block truncate">
                    {r.name}{r.admin1 ? `, ${r.admin1}` : ''}
                  </span>
                  <span className="text-[9px] font-mono text-stone-400">{r.country}</span>
                </span>
                <span className="text-[9px] font-mono text-stone-400 shrink-0">
                  {r.latitude.toFixed(3)}, {r.longitude.toFixed(3)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showManual && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400">{isKa ? 'განედი' : 'Latitude'}</label>
            <input
              type="number"
              step="0.0001"
              value={latitude}
              onChange={(e) => onChange({ latitude: parseFloat(e.target.value) || 0, longitude })}
              className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-xs font-mono text-stone-900 outline-none focus:border-emerald-600"
            />
          </div>
          <div>
            <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400">{isKa ? 'გრძედი' : 'Longitude'}</label>
            <input
              type="number"
              step="0.0001"
              value={longitude}
              onChange={(e) => onChange({ latitude, longitude: parseFloat(e.target.value) || 0 })}
              className="w-full bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-xs font-mono text-stone-900 outline-none focus:border-emerald-600"
            />
          </div>
        </div>
      )}
    </div>
  );
}
