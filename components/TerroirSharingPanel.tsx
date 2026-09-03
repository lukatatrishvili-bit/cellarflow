import React from 'react';
import { Check, ExternalLink, Eye, EyeOff, Globe2, Loader2, MapPin, ShieldCheck, Users } from 'lucide-react';
import type { Language } from '../lib/i18n';
import {
  DEFAULT_TERROIR_SHARING_SETTINGS,
  type TerroirSharingSettings,
} from '../lib/terroirPulse';

interface SharingBlock {
  id: string;
  name: string;
  variety: string;
  area: number;
  region: string;
  terroir: string;
}

interface TerroirSharingPanelProps {
  lang: Language;
  role: string;
  organizationId?: string;
  setToastMessage: (value: string | null) => void;
}

interface SharingResponse {
  settings: TerroirSharingSettings;
  blocks: SharingBlock[];
}

const ALLOWED_ROLES = new Set(['Owner/Admin', 'Winemaker', 'Viticulturist']);

export default function TerroirSharingPanel({
  lang,
  role,
  organizationId,
  setToastMessage,
}: TerroirSharingPanelProps) {
  const [settings, setSettings] = React.useState<TerroirSharingSettings>({
    ...DEFAULT_TERROIR_SHARING_SETTINGS,
  });
  const [blocks, setBlocks] = React.useState<SharingBlock[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const isKa = lang === 'ka';

  React.useEffect(() => {
    if (!ALLOWED_ROLES.has(role)) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/terroir-pulse/settings', { headers: { Accept: 'application/json' } })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Could not load sharing preferences.');
        return body as SharingResponse;
      })
      .then(body => {
        if (cancelled) return;
        setSettings({ ...DEFAULT_TERROIR_SHARING_SETTINGS, ...body.settings });
        setBlocks(Array.isArray(body.blocks) ? body.blocks : []);
      })
      .catch(fetchError => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : 'Could not load sharing preferences.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [organizationId, role]);

  if (!ALLOWED_ROLES.has(role)) return null;

  const toggleBlock = (blockId: string) => {
    setSettings(current => ({
      ...current,
      selectedBlockIds: current.selectedBlockIds.includes(blockId)
        ? current.selectedBlockIds.filter(id => id !== blockId)
        : [...current.selectedBlockIds, blockId],
    }));
  };

  const save = async () => {
    setError(null);
    if (settings.enabled && settings.selectedBlockIds.length === 0) {
      setError(isKa ? 'აირჩიეთ მინიმუმ ერთი ვენახის ნაკვეთი.' : 'Select at least one vineyard block.');
      return;
    }
    if (settings.enabled && !settings.shareSampling && !settings.shareHarvest) {
      setError(isKa ? 'აირჩიეთ გასაზიარებელი მონაცემების ტიპი.' : 'Select at least one data category.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/terroir-pulse/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(settings),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not save sharing preferences.');
      setSettings({ ...DEFAULT_TERROIR_SHARING_SETTINGS, ...body.settings });
      setToastMessage(settings.enabled
        ? (isKa ? 'Terroir Pulse-ის გაზიარება ჩართულია.' : 'Terroir Pulse sharing is enabled.')
        : (isKa ? 'Terroir Pulse-ის გაზიარება გამორთულია.' : 'Terroir Pulse sharing is disabled.'));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save sharing preferences.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm dark:border-emerald-900/60 dark:bg-stone-950">
      <div className="relative overflow-hidden border-b border-emerald-100 bg-gradient-to-br from-[#183d2b] via-[#24523a] to-[#173526] p-6 text-white">
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full border border-white/10 bg-white/5" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div className="flex gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10">
              <Globe2 className="h-5 w-5 text-emerald-100" aria-hidden="true" />
            </span>
            <div>
              <p className="font-mono text-[9px] font-black uppercase tracking-[0.24em] text-emerald-200">
                {isKa ? 'საზოგადოებრივი რთველის მონაცემები' : 'Community vintage intelligence'}
              </p>
              <h3 className="mt-1 font-serif text-xl font-black tracking-wide">Terroir Pulse</h3>
              <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-emerald-50/75">
                {isKa
                  ? 'გააზიარეთ შერჩეული ნაკვეთების მონაცემები მხოლოდ კონფიდენციალურ, რეგიონულ აგრეგატებში.'
                  : 'Contribute selected blocks to privacy-protected regional benchmarks. Raw records, block names, coordinates, and exact organization values are never published.'}
              </p>
            </div>
          </div>
          <a
            href="/terroir-pulse"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-white transition-colors hover:bg-white/20"
          >
            {isKa ? 'საჯარო გვერდი' : 'View public page'} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {loading ? (
          <div className="flex min-h-32 items-center justify-center gap-2 text-stone-500" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>{isKa ? 'პარამეტრების ჩატვირთვა…' : 'Loading sharing preferences…'}</span>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-5 rounded-xl border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900">
              <div className="flex gap-3">
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${settings.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-500'}`}>
                  {settings.enabled ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
                </span>
                <div>
                  <h4 className="text-xs font-black text-stone-900 dark:text-stone-100">
                    {isKa ? 'მონაცემთა გაზიარება' : 'Contribute to Terroir Pulse'}
                  </h4>
                  <p className="mt-1 text-[10px] leading-relaxed text-stone-500">
                    {settings.enabled
                      ? (isKa ? 'არჩეული ნაკვეთები აგრეგირებაში მონაწილეობს.' : 'Selected blocks can contribute after the anonymity threshold is met.')
                      : (isKa ? 'არცერთი მონაცემი არ ქვეყნდება.' : 'Off by default. No vineyard data is currently contributed.')}
                  </p>
                </div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center" aria-label={isKa ? 'გაზიარების ჩართვა' : 'Enable data sharing'}>
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={event => setSettings(current => ({ ...current, enabled: event.target.checked }))}
                  className="peer sr-only"
                />
                <span className="h-6 w-11 rounded-full bg-stone-300 transition-colors after:absolute after:left-[3px] after:top-[3px] after:h-[18px] after:w-[18px] after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-emerald-700 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-600 peer-focus-visible:ring-offset-2" />
              </label>
            </div>

            <fieldset disabled={!settings.enabled} className="space-y-3 disabled:opacity-55">
              <legend className="text-[9px] font-black uppercase tracking-[0.17em] text-stone-500">
                {isKa ? 'კონფიდენციალურობა' : 'Publication identity'}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {([
                  { id: 'anonymous', icon: ShieldCheck, title: 'Anonymous aggregate', detail: 'Your organization is never named.' },
                  { id: 'attributed', icon: Users, title: 'Named contributor', detail: 'Your name appears, but individual values remain private.' },
                ] as const).map(option => {
                  const Icon = option.icon;
                  const checked = settings.privacyMode === option.id;
                  return (
                    <label key={option.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors ${checked ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/20' : 'border-stone-200 hover:border-stone-300 dark:border-stone-800'}`}>
                      <input
                        type="radio"
                        name="terroir-privacy"
                        value={option.id}
                        checked={checked}
                        onChange={() => setSettings(current => ({ ...current, privacyMode: option.id }))}
                        className="mt-1 accent-emerald-700"
                      />
                      <span>
                        <span className="flex items-center gap-2 text-[11px] font-black text-stone-800 dark:text-stone-100">
                          <Icon className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" /> {isKa ? (option.id === 'anonymous' ? 'ანონიმური აგრეგატი' : 'დასახელებული მონაწილე') : option.title}
                        </span>
                        <span className="mt-1 block text-[10px] leading-relaxed text-stone-500">
                          {isKa ? (option.id === 'anonymous' ? 'თქვენი ორგანიზაცია არ დასახელდება.' : 'სახელი გამოჩნდება, ინდივიდუალური მნიშვნელობები — არა.') : option.detail}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {settings.privacyMode === 'attributed' && (
                <label className="block max-w-md">
                  <span className="mb-1.5 block text-[9px] font-black uppercase tracking-wider text-stone-500">
                    {isKa ? 'საჯარო მონაწილის სახელი' : 'Public contributor name'}
                  </span>
                  <input
                    type="text"
                    value={settings.attributionName}
                    maxLength={100}
                    onChange={event => setSettings(current => ({ ...current, attributionName: event.target.value }))}
                    placeholder={isKa ? 'მარნის ან კომპანიის სახელი' : 'Winery or company name'}
                    className="w-full rounded-lg border border-stone-250 bg-white px-3 py-2.5 text-xs font-bold text-stone-900 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                  />
                </label>
              )}
            </fieldset>

            <fieldset disabled={!settings.enabled} className="space-y-3 disabled:opacity-55">
              <legend className="text-[9px] font-black uppercase tracking-[0.17em] text-stone-500">
                {isKa ? 'გასაზიარებელი მონაცემები' : 'Data categories'}
              </legend>
              <div className="flex flex-wrap gap-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900">
                  <input
                    type="checkbox"
                    checked={settings.shareSampling}
                    onChange={event => setSettings(current => ({ ...current, shareSampling: event.target.checked }))}
                    className="accent-emerald-700"
                  />
                  <span className="text-[10px] font-bold text-stone-700 dark:text-stone-200">{isKa ? 'სიმწიფე, ფენოლოგია და წნეხი' : 'Maturity, phenology & disease pressure'}</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900">
                  <input
                    type="checkbox"
                    checked={settings.shareHarvest}
                    onChange={event => setSettings(current => ({ ...current, shareHarvest: event.target.checked }))}
                    className="accent-emerald-700"
                  />
                  <span className="text-[10px] font-bold text-stone-700 dark:text-stone-200">{isKa ? 'რთველის მიმდინარეობა და ფანჯარა' : 'Harvest progress & timing window'}</span>
                </label>
              </div>
            </fieldset>

            <fieldset disabled={!settings.enabled} className="space-y-3 disabled:opacity-55">
              <div className="flex items-end justify-between gap-4">
                <legend className="text-[9px] font-black uppercase tracking-[0.17em] text-stone-500">
                  {isKa ? 'ნაკვეთების არჩევა' : 'Contributing blocks'}
                </legend>
                {blocks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSettings(current => ({
                      ...current,
                      selectedBlockIds: current.selectedBlockIds.length === blocks.length ? [] : blocks.map(block => block.id),
                    }))}
                    className="text-[9px] font-black uppercase tracking-wider text-emerald-800 hover:underline dark:text-emerald-400"
                  >
                    {settings.selectedBlockIds.length === blocks.length ? (isKa ? 'ყველას მოხსნა' : 'Clear all') : (isKa ? 'ყველას არჩევა' : 'Select all')}
                  </button>
                )}
              </div>
              {blocks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-[10px] text-stone-500 dark:border-stone-700">
                  {isKa ? 'ჯერ დაამატეთ ვენახის ნაკვეთი, რათა გაზიარება შეძლოთ.' : 'Add a vineyard block before enabling data sharing.'}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {blocks.map(block => {
                    const checked = settings.selectedBlockIds.includes(block.id);
                    return (
                      <label key={block.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${checked ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20' : 'border-stone-200 hover:border-stone-300 dark:border-stone-800'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBlock(block.id)}
                          className="mt-1 accent-emerald-700"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] font-black text-stone-850 dark:text-stone-100">{block.name}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-stone-500">
                            <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" /> {block.terroir}</span>
                            <span>{block.variety || '—'}</span>
                            <span>{block.area.toLocaleString(undefined, { maximumFractionDigits: 1 })} ha</span>
                          </span>
                        </span>
                        {checked && <Check className="ml-auto h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />}
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-[10px] leading-relaxed text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
              <strong className="font-black">{isKa ? 'კონფიდენციალურობის ზღვარი:' : 'Privacy threshold:'}</strong>{' '}
              {isKa
                ? 'შედეგი გამოჩნდება მხოლოდ მაშინ, როცა ჯგუფში სულ მცირე 5 დამოუკიდებელი ორგანიზაცია და 5 ჰექტარია; არც ერთ მონაწილეს არ უნდა ჰქონდეს 40%-ზე მეტი წილი. მონაცემები 7 დღით გვიან ქვეყნდება.'
                : 'A result appears only with at least 5 independent organizations and 5 represented hectares, with no contributor above 40% of the group. Observations are delayed by 7 days.'}
            </div>

            {error && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[10px] font-bold text-rose-800 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-200" role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#183d2b] px-5 py-3 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#102c1e] disabled:cursor-wait disabled:opacity-60 sm:w-auto"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {saving ? (isKa ? 'ინახება…' : 'Saving…') : (isKa ? 'გაზიარების პარამეტრების შენახვა' : 'Save sharing preferences')}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
