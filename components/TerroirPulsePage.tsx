import React from 'react';
import {
  Activity, ArrowLeft, CalendarDays, ChevronRight, Clock3, Droplets,
  FlaskConical, Gauge, Globe2, Grape, Layers3, Leaf, Loader2,
  MapPin, ShieldCheck, Sprout, Users,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { TerroirPulseGroup, TerroirPulsePublication } from '../lib/terroirPulse';

interface TerroirPulsePageProps {
  lang: Language;
  isLoggedIn: boolean;
}

const dateLabel = (value: string | null, lang: Language): string => {
  if (!value) return '—';
  return new Intl.DateTimeFormat(lang === 'ka' ? 'ka-GE' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
};

const pressureStyle = (pressure: TerroirPulseGroup['metrics']['diseasePressure']) => {
  if (pressure === 'high') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (pressure === 'medium') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (pressure === 'low') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return 'border-stone-200 bg-stone-50 text-stone-500';
};

function PulseCard({ group, lang }: { group: TerroirPulseGroup; lang: Language }) {
  const isKa = lang === 'ka';
  const progress = group.metrics.harvestProgressPct;
  const harvestWindow = group.metrics.harvestWindowStart && group.metrics.harvestWindowEnd
    ? `${dateLabel(group.metrics.harvestWindowStart, lang)} – ${dateLabel(group.metrics.harvestWindowEnd, lang)}`
    : dateLabel(group.metrics.medianHarvestDate, lang);

  return (
    <article className="group overflow-hidden rounded-2xl border border-[#ded7ce] bg-white shadow-[0_16px_40px_-28px_rgba(43,31,23,0.45)] transition-all hover:-translate-y-0.5 hover:border-emerald-300 dark:border-stone-800 dark:bg-stone-925">
      <div className="border-b border-stone-100 bg-gradient-to-br from-stone-50 to-emerald-50/45 p-5 dark:border-stone-800 dark:from-stone-900 dark:to-emerald-950/10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#183d2b] px-2.5 py-1 font-mono text-[8px] font-black uppercase tracking-[0.15em] text-emerald-50">
                {group.level === 'terroir' ? (isKa ? 'ტერუარი' : 'Terroir') : (isKa ? 'რეგიონი' : 'Region')}
              </span>
              <span className="font-mono text-[9px] font-bold text-stone-400">{group.vintage}</span>
            </div>
            <h3 className="mt-3 truncate font-serif text-xl font-black text-[#28211d] dark:text-stone-100">{group.terroir}</h3>
            <p className="mt-1 flex items-center gap-1.5 truncate text-[10px] font-semibold text-stone-500">
              <MapPin className="h-3 w-3 shrink-0 text-emerald-700" aria-hidden="true" /> {group.region}, {group.country}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-white p-3 text-center shadow-sm dark:border-emerald-900 dark:bg-stone-900">
            <Grape className="mx-auto h-4 w-4 text-[#6b1420]" aria-hidden="true" />
            <span className="mt-1 block max-w-24 truncate text-[10px] font-black text-[#4e0e15] dark:text-amber-200">{group.variety}</span>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div>
          <div className="mb-2 flex items-end justify-between gap-3">
            <span className="text-[9px] font-black uppercase tracking-[0.15em] text-stone-400">{isKa ? 'რთველის მიმდინარეობა' : 'Harvest progress'}</span>
            <span className="font-mono text-lg font-black text-[#183d2b] dark:text-emerald-300">{progress === null ? '—' : `${progress}%`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-stone-150 dark:bg-stone-800">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-700 to-amber-500" style={{ width: `${progress || 0}%` }} aria-hidden="true" />
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2">
          {[
            { icon: Gauge, label: 'Brix', value: group.metrics.medianBrix === null ? '—' : group.metrics.medianBrix.toFixed(1) },
            { icon: FlaskConical, label: 'pH', value: group.metrics.medianPh === null ? '—' : group.metrics.medianPh.toFixed(2) },
            { icon: Droplets, label: isKa ? 'მჟავიანობა' : 'Acidity', value: group.metrics.medianTotalAcidityGL === null ? '—' : `${group.metrics.medianTotalAcidityGL.toFixed(1)} g/L` },
          ].map(metric => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="rounded-xl border border-stone-100 bg-stone-50/80 p-3 text-center dark:border-stone-800 dark:bg-stone-900">
                <Icon className="mx-auto h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                <dt className="mt-1.5 text-[8px] font-black uppercase tracking-wider text-stone-400">{metric.label}</dt>
                <dd className="mt-1 font-mono text-[11px] font-black text-stone-800 dark:text-stone-100">{metric.value}</dd>
              </div>
            );
          })}
        </dl>

        <dl className="space-y-2.5 border-t border-stone-100 pt-4 text-[10px] dark:border-stone-800">
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-2 text-stone-500"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> {isKa ? 'რთველის ფანჯარა' : 'Harvest window'}</dt>
            <dd className="text-right font-bold text-stone-800 dark:text-stone-200">{harvestWindow}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-2 text-stone-500"><Sprout className="h-3.5 w-3.5" aria-hidden="true" /> {isKa ? 'ფენოლოგია' : 'Phenology'}</dt>
            <dd className="max-w-[55%] truncate text-right font-bold text-stone-800 dark:text-stone-200">{group.metrics.phenologyStage || '—'}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-2 text-stone-500"><Leaf className="h-3.5 w-3.5" aria-hidden="true" /> {isKa ? 'დაავადების წნეხი' : 'Disease pressure'}</dt>
            <dd className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider ${pressureStyle(group.metrics.diseasePressure)}`}>
              {group.metrics.diseasePressure || (isKa ? 'არ არის' : 'Not reported')}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f5f1eb] px-3 py-2.5 text-[9px] text-stone-600 dark:bg-stone-900 dark:text-stone-400">
          <span className="inline-flex items-center gap-1.5"><Users className="h-3 w-3" aria-hidden="true" /> {group.contributors} {isKa ? 'მონაწილე' : 'contributors'}</span>
          <span className="inline-flex items-center gap-1.5"><Layers3 className="h-3 w-3" aria-hidden="true" /> {group.blocks} {isKa ? 'ნაკვეთი' : 'blocks'} · {group.representedHectares} ha</span>
        </div>

        {group.attributedContributors.length > 0 && (
          <p className="text-[9px] leading-relaxed text-stone-500">
            <strong className="text-stone-700 dark:text-stone-300">{isKa ? 'დასახელებული მონაწილეები:' : 'Named contributors:'}</strong>{' '}{group.attributedContributors.join(', ')}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-[8px] font-semibold uppercase tracking-wider text-stone-400">
          <Clock3 className="h-3 w-3" aria-hidden="true" /> {isKa ? 'ბოლო ჩართული დაკვირვება' : 'Latest included observation'} {dateLabel(group.lastObservationDate, lang)}
        </p>
      </div>
    </article>
  );
}

export default function TerroirPulsePage({ lang, isLoggedIn }: TerroirPulsePageProps) {
  const [publication, setPublication] = React.useState<TerroirPulsePublication | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [vintage, setVintage] = React.useState('');
  const [country, setCountry] = React.useState('');
  const [region, setRegion] = React.useState('');
  const [variety, setVariety] = React.useState('');
  const [level, setLevel] = React.useState<'all' | 'terroir' | 'region'>('all');
  const isKa = lang === 'ka';

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/terroir-pulse', { headers: { Accept: 'application/json' } })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Could not load the regional vintage pulse.');
        return body as TerroirPulsePublication;
      })
      .then(body => {
        if (cancelled) return;
        setPublication(body);
        const newestVintage = Math.max(...body.groups.map(group => group.vintage));
        if (Number.isFinite(newestVintage)) setVintage(String(newestVintage));
      })
      .catch(fetchError => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : 'Could not load the regional vintage pulse.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const allGroups = publication?.groups || [];
  const values = (selector: (group: TerroirPulseGroup) => string | number) => (
    [...new Set(allGroups.map(selector))].sort((left, right) => (
      typeof left === 'number' && typeof right === 'number' ? right - left : String(left).localeCompare(String(right))
    ))
  );
  const countries = values(group => group.country) as string[];
  const regions = values(group => group.region) as string[];
  const varieties = values(group => group.variety) as string[];
  const vintages = values(group => group.vintage) as number[];
  const visibleGroups = allGroups.filter(group => (
    (!vintage || String(group.vintage) === vintage)
    && (!country || group.country === country)
    && (!region || group.region === region)
    && (!variety || group.variety === variety)
    && (level === 'all' || group.level === level)
  ));
  const terroirGroups = visibleGroups.filter(group => group.level === 'terroir');
  const regionGroups = visibleGroups.filter(group => group.level === 'region');

  return (
    <main className="min-h-[82vh] flex-1 bg-[#f5f1eb] text-stone-800 dark:bg-[#0d0b09] dark:text-stone-100">
      <section className="relative overflow-hidden bg-[#183d2b] text-white">
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_20%,rgba(197,160,89,0.45),transparent_30%),radial-gradient(circle_at_80%_70%,rgba(78,14,21,0.45),transparent_35%)]" />
        <div className="relative mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20">
          <a href="/" className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-emerald-100/80 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {isLoggedIn ? (isKa ? 'სამუშაო სივრცეში დაბრუნება' : 'Back to workspace') : (isKa ? 'VinOS-ში შესვლა' : 'Sign in to VinOS')}
          </a>
          <div className="mt-9 max-w-3xl">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10"><Globe2 className="h-5 w-5" aria-hidden="true" /></span>
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.25em] text-[#dfc788]">{isKa ? 'რთველის საჯარო სურათი' : 'Open regional vintage intelligence'}</p>
            </div>
            <h1 className="mt-6 font-serif text-4xl font-black leading-tight tracking-tight sm:text-6xl">Terroir Pulse</h1>
            <p className="mt-5 max-w-2xl font-serif text-base leading-relaxed text-emerald-50/75 sm:text-lg">
              {isKa
                ? 'ნახეთ, როგორ ვითარდება ყურძნის სიმწიფე და რთველი რეგიონებსა და ტერუარებში — მონაწილე მევენახეებისა და მეღვინეების კონფიდენციალური მონაცემების საფუძველზე.'
                : 'See how grape maturity and harvest are moving across regions and terroirs, built from privacy-protected observations shared by growers and winemakers.'}
            </p>
            {publication && (
              <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-emerald-50/80">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> {isKa ? 'მონაცემები ჩათვლით' : 'Observations through'} {dateLabel(publication.publishedThrough, lang)}
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
        {loading ? (
          <div className="flex min-h-80 items-center justify-center gap-3" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-700" aria-hidden="true" />
            <span className="text-sm font-bold text-stone-500">{isKa ? 'რეგიონული მონაცემების ჩატვირთვა…' : 'Loading regional vintage data…'}</span>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm dark:border-rose-900 dark:bg-stone-950" role="alert">
            <Activity className="mx-auto h-7 w-7 text-rose-700" aria-hidden="true" />
            <h2 className="mt-3 font-serif text-xl font-black">{isKa ? 'მონაცემები დროებით მიუწვდომელია' : 'The pulse is temporarily unavailable'}</h2>
            <p className="mt-2 text-xs text-stone-500">{error}</p>
          </div>
        ) : publication ? (
          <>
            <section aria-label={isKa ? 'ფილტრები' : 'Pulse filters'} className="relative z-10 -mt-16 rounded-2xl border border-[#ded7ce] bg-white p-4 shadow-[0_24px_60px_-34px_rgba(25,20,16,0.65)] dark:border-stone-800 dark:bg-stone-950 sm:p-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  { label: isKa ? 'მოსავალი' : 'Vintage', value: vintage, setter: setVintage, options: vintages.map(String) },
                  { label: isKa ? 'ქვეყანა' : 'Country', value: country, setter: setCountry, options: countries },
                  { label: isKa ? 'რეგიონი' : 'Region', value: region, setter: setRegion, options: regions },
                  { label: isKa ? 'ჯიში' : 'Variety', value: variety, setter: setVariety, options: varieties },
                ].map(filter => (
                  <label key={filter.label}>
                    <span className="mb-1.5 block font-mono text-[8px] font-black uppercase tracking-[0.15em] text-stone-400">{filter.label}</span>
                    <select value={filter.value} onChange={event => filter.setter(event.target.value)} className="min-h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-[11px] font-bold outline-none focus:border-emerald-600 dark:border-stone-800 dark:bg-stone-900">
                      <option value="">{isKa ? 'ყველა' : 'All'}</option>
                      {filter.options.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                ))}
                <label>
                  <span className="mb-1.5 block font-mono text-[8px] font-black uppercase tracking-[0.15em] text-stone-400">{isKa ? 'დონე' : 'View'}</span>
                  <select value={level} onChange={event => setLevel(event.target.value as typeof level)} className="min-h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-[11px] font-bold outline-none focus:border-emerald-600 dark:border-stone-800 dark:bg-stone-900">
                    <option value="all">{isKa ? 'ყველა დონე' : 'All levels'}</option>
                    <option value="terroir">{isKa ? 'ტერუარები' : 'Terroirs'}</option>
                    <option value="region">{isKa ? 'რეგიონები' : 'Regions'}</option>
                  </select>
                </label>
              </div>
            </section>

            {visibleGroups.length === 0 ? (
              <section className="mt-10 rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-16 text-center dark:border-stone-700 dark:bg-stone-950">
                <ShieldCheck className="mx-auto h-8 w-8 text-emerald-700" aria-hidden="true" />
                <h2 className="mt-4 font-serif text-xl font-black">
                  {allGroups.length === 0
                    ? (isKa ? 'ჯერ არც ერთი რეგიონი არ აკმაყოფილებს კონფიდენციალურობის ზღვარს' : 'No region meets the privacy threshold yet')
                    : (isKa ? 'ამ ფილტრებისთვის შედეგი არ მოიძებნა' : 'No results match these filters')}
                </h2>
                <p className="mx-auto mt-2 max-w-xl text-[11px] leading-relaxed text-stone-500">
                  {allGroups.length === 0
                    ? (isKa ? 'მონაცემი გამოჩნდება მხოლოდ საკმარისი დამოუკიდებელი მონაწილეებისა და ფართობის დაგროვების შემდეგ.' : 'A result is published only after enough independent contributors and represented vineyard area are available. Small groups remain completely hidden.')
                    : (isKa ? 'შეცვალეთ ან გაასუფთავეთ ერთი ან მეტი ფილტრი.' : 'Change or clear one or more filters to broaden the view.')}
                </p>
              </section>
            ) : (
              <div className="mt-10 space-y-12">
                {terroirGroups.length > 0 && (
                  <section>
                    <div className="mb-5 flex items-end justify-between gap-4">
                      <div><p className="font-mono text-[9px] font-black uppercase tracking-[0.2em] text-emerald-700">{isKa ? 'ადგილობრივი სურათი' : 'Local vintage view'}</p><h2 className="mt-1 font-serif text-2xl font-black">{isKa ? 'ტერუარები და მიკროზონები' : 'Terroirs & microzones'}</h2></div>
                      <span className="text-[10px] font-bold text-stone-400">{terroirGroups.length} {isKa ? 'შედეგი' : 'results'}</span>
                    </div>
                    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{terroirGroups.map(group => <PulseCard key={group.id} group={group} lang={lang} />)}</div>
                  </section>
                )}
                {regionGroups.length > 0 && (
                  <section>
                    <div className="mb-5 flex items-end justify-between gap-4">
                      <div><p className="font-mono text-[9px] font-black uppercase tracking-[0.2em] text-[#7a5c23]">{isKa ? 'ფართო სურათი' : 'Regional fallback'}</p><h2 className="mt-1 font-serif text-2xl font-black">{isKa ? 'რეგიონული მიმოხილვა' : 'Regional overview'}</h2></div>
                      <span className="text-[10px] font-bold text-stone-400">{regionGroups.length} {isKa ? 'შედეგი' : 'results'}</span>
                    </div>
                    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{regionGroups.map(group => <PulseCard key={group.id} group={group} lang={lang} />)}</div>
                  </section>
                )}
              </div>
            )}

            <section className="mt-14 grid overflow-hidden rounded-2xl border border-[#ded7ce] bg-white dark:border-stone-800 dark:bg-stone-950 lg:grid-cols-[1fr_0.7fr]">
              <div className="p-6 sm:p-8">
                <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800"><ShieldCheck className="h-4 w-4" aria-hidden="true" /></span><div><p className="font-mono text-[8px] font-black uppercase tracking-[0.18em] text-emerald-700">{isKa ? 'მეთოდოლოგია' : 'Publication methodology'}</p><h2 className="font-serif text-lg font-black">{isKa ? 'კონფიდენციალურობა თავიდანვე' : 'Privacy by construction'}</h2></div></div>
                <p className="mt-4 max-w-2xl text-[11px] leading-6 text-stone-600 dark:text-stone-400">
                  {isKa ? 'თითო ორგანიზაცია თითო მეტრიკაში ერთ თანაბარ ხმას იღებს. ქვეყნდება მედიანები და არა ნედლი ჩანაწერები. ნაკვეთის სახელები, კოორდინატები და ორგანიზაციის ინდივიდუალური მნიშვნელობები პასუხში არ შედის.' : 'Each organization contributes one equally weighted value per metric. We publish medians—not raw observations. Block names, coordinates, organization IDs, and individual organization values never enter the public response.'}
                </p>
              </div>
              <dl className="grid grid-cols-2 border-t border-stone-100 bg-stone-50 dark:border-stone-800 dark:bg-stone-900 lg:border-l lg:border-t-0">
                {[
                  { label: isKa ? 'მინ. მონაწილე' : 'Minimum contributors', value: publication.methodology.minimumContributors },
                  { label: isKa ? 'მინ. ფართობი' : 'Minimum area', value: `${publication.methodology.minimumHectares} ha` },
                  { label: isKa ? 'მაქს. ერთი წილი' : 'Maximum single share', value: `${publication.methodology.maximumContributorSharePct}%` },
                  { label: isKa ? 'დაყოვნება' : 'Publication delay', value: `${publication.methodology.publicationDelayDays} ${isKa ? 'დღე' : 'days'}` },
                ].map(item => <div key={item.label} className="border-b border-r border-stone-150 p-5 text-center dark:border-stone-800"><dt className="text-[8px] font-black uppercase tracking-wider text-stone-400">{item.label}</dt><dd className="mt-2 font-mono text-lg font-black text-[#183d2b] dark:text-emerald-300">{item.value}</dd></div>)}
              </dl>
            </section>

            <section className="mt-8 flex flex-col items-start justify-between gap-5 rounded-2xl bg-[#4e0e15] p-6 text-white sm:flex-row sm:items-center sm:p-8">
              <div><h2 className="font-serif text-xl font-black">{isKa ? 'მონაწილეობთ რთველში?' : 'Working this vintage?'}</h2><p className="mt-1 text-[11px] text-rose-50/70">{isKa ? 'VinOS-ში აირჩიეთ ნაკვეთები და ანონიმურად გააზიარეთ მათი მონაცემები.' : 'Select vineyard blocks in VinOS and contribute them anonymously to the shared picture.'}</p></div>
              <a href="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-5 py-3 text-[10px] font-black uppercase tracking-wider text-[#4e0e15] hover:bg-amber-50">
                {isLoggedIn ? (isKa ? 'სამუშაო სივრცის გახსნა' : 'Open workspace') : (isKa ? 'დაწყება' : 'Get started')} <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
