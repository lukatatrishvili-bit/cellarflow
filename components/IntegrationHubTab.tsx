import React from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  DatabaseZap,
  FileJson,
  GitBranch,
  Loader2,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import {
  ActionButton,
  EmptyState,
  FieldLabel,
  FormSection,
  InlineNotice,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusBadge,
  cx,
} from './ui/primitives';
import type { Language } from '../lib/i18n';
import type {
  ConnectorConfigInput,
  FieldMappingInput,
  IntegrationConnectorConfig,
  IntegrationConnectorDefinition,
  IntegrationDomainDefinition,
  IntegrationExternalReference,
  IntegrationFieldMapping,
  IntegrationHubState,
  IntegrationSyncDirection,
  IntegrationSyncDomain,
  IntegrationSyncFormat,
  IntegrationSyncJob,
  IntegrationSyncEvent,
  IntegrationConflictRecord,
  SourceOfTruthRule,
} from '../lib/integrations';
import {
  connectorDisplayName,
  connectorSettingsDisplay,
  integrationDomainLabel,
  sourceOfTruthDisplay,
} from '../lib/integrationLabels';

interface IntegrationHubTabProps {
  lang?: Language;
  setToastMessage: (msg: string | null) => void;
}

interface HubResponse {
  catalog: IntegrationConnectorDefinition[];
  domains: IntegrationDomainDefinition[];
  sourceOfTruth: Record<IntegrationSyncDomain, SourceOfTruthRule>;
  hub: PublicHub;
}

interface PublicHub extends Omit<IntegrationHubState, 'jobs'> {
  jobs: IntegrationSyncJob[];
}

const DEFAULT_MAPPING_ROWS: Array<Pick<FieldMappingInput, 'localField' | 'externalField' | 'required'>> = [
  { localField: 'localId', externalField: 'CellarFlowID', required: true },
  { localField: 'name', externalField: 'Description', required: true },
  { localField: 'externalId', externalField: 'Ref', required: false },
];

function statusTone(status: string): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'succeeded' || status === 'configured') return 'success';
  if (status === 'failed' || status === 'error') return 'danger';
  if (status === 'needs_review' || status === 'pending') return 'warning';
  if (status === 'running') return 'info';
  return 'neutral';
}

function formatDate(value: string | null | undefined, ka: boolean): string {
  if (!value) return ka ? 'ჯერ არა' : 'Not yet';
  try {
    return new Date(value).toLocaleString(ka ? 'ka-GE' : undefined);
  } catch {
    return value;
  }
}

function downloadArtifact(job: IntegrationSyncJob): void {
  if (!job.exportArtifact) return;
  const type = job.exportArtifact.format === 'json' ? 'application/json' : 'text/csv';
  const blob = new Blob([job.exportArtifact.content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = job.exportArtifact.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function IntegrationHubTab({ lang = 'en', setToastMessage }: IntegrationHubTabProps) {
  const ka = lang === 'ka';
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [pulling, setPulling] = React.useState(false);
  const [liveEntitySet, setLiveEntitySet] = React.useState('');
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string; entitySets: string[] } | null>(null);
  const [catalog, setCatalog] = React.useState<IntegrationConnectorDefinition[]>([]);
  const [domains, setDomains] = React.useState<IntegrationDomainDefinition[]>([]);
  const [sourceOfTruth, setSourceOfTruth] = React.useState<Record<string, SourceOfTruthRule>>({});
  const [hub, setHub] = React.useState<PublicHub | null>(null);
  const [activePanel, setActivePanel] = React.useState<'overview' | 'queue' | 'mappings' | 'refs'>('overview');
  const [selectedDomain, setSelectedDomain] = React.useState<IntegrationSyncDomain>('products');
  const [mappingDirection, setMappingDirection] = React.useState<IntegrationSyncDirection>('export');
  const [jobDirection, setJobDirection] = React.useState<IntegrationSyncDirection>('export');
  const [jobFormat, setJobFormat] = React.useState<IntegrationSyncFormat>('json');
  const [importPayload, setImportPayload] = React.useState('');
  const [secretValue, setSecretValue] = React.useState('');
  const [conflictNotes, setConflictNotes] = React.useState<Record<string, string>>({});
  const [mappingRows, setMappingRows] = React.useState<FieldMappingInput[]>(
    DEFAULT_MAPPING_ROWS.map((row) => ({
      domain: 'products',
      direction: 'export',
      transform: 'none',
      ...row,
    })),
  );

  const dirLabel = (dir: IntegrationSyncDirection) => ka ? (dir === 'export' ? 'ექსპორტი' : 'იმპორტი') : dir;

  const connector = hub?.connectors[0] || null;
  const definition = catalog[0] || null;
  const failedJobs = hub?.jobs.filter((job) => job.status === 'failed' || job.status === 'needs_review') || [];
  const openConflicts = hub?.conflicts.filter((conflict) => conflict.status === 'open') || [];
  const lastJob = hub?.jobs[0] || null;

  const loadHub = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/integrations/connectors');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load Integration Hub');
      const payload = data as HubResponse;
      setCatalog(payload.catalog || []);
      setDomains(payload.domains || []);
      setSourceOfTruth(payload.sourceOfTruth || {});
      setHub(payload.hub);
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : (ka ? 'ჩატვირთვა ვერ მოხერხდა' : 'Load failed')}`);
    } finally {
      setLoading(false);
    }
  }, [setToastMessage, ka]);

  React.useEffect(() => {
    loadHub();
  }, [loadHub]);

  React.useEffect(() => {
    const existing = hub?.mappings.filter((mapping) => mapping.domain === selectedDomain && mapping.direction === mappingDirection) || [];
    if (existing.length > 0) {
      setMappingRows(existing.map((mapping) => ({
        domain: mapping.domain,
        direction: mapping.direction,
        localField: mapping.localField,
        externalField: mapping.externalField,
        required: mapping.required,
        transform: mapping.transform || 'none',
      })));
      return;
    }
    setMappingRows(DEFAULT_MAPPING_ROWS.map((row) => ({
      domain: selectedDomain,
      direction: mappingDirection,
      transform: 'none',
      ...row,
    })));
  }, [hub?.mappings, selectedDomain, mappingDirection]);

  const saveConnector = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connector) return;
    setSaving(true);
    const fd = new FormData(event.currentTarget);
    const authMode = String(fd.get('authMode') || 'none') as ConnectorConfigInput['authMode'];
    const body: ConnectorConfigInput = {
      enabled: fd.get('enabled') === 'on',
      endpointUrl: String(fd.get('endpointUrl') || ''),
      authMode,
      username: String(fd.get('username') || ''),
      databaseName: String(fd.get('databaseName') || ''),
      exchangeMode: (String(fd.get('exchangeMode') || 'manual_json_csv') as ConnectorConfigInput['exchangeMode']),
      defaultExportFormat: String(fd.get('defaultExportFormat') || 'json') as IntegrationSyncFormat,
    };
    if (secretValue.trim()) {
      if (authMode === 'api_key') body.apiKey = secretValue;
      else if (authMode === 'bearer') body.bearerToken = secretValue;
      else body.password = secretValue;
    }

    try {
      const res = await fetch(`/api/integrations/connectors/${connector.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Configuration failed');
      setHub(data.hub);
      setSecretValue('');
      setToastMessage(ka ? 'კონექტორი შენახულია.' : 'Integration connector saved.');
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : (ka ? 'შენახვა ვერ მოხერხდა' : 'Save failed')}`);
    } finally {
      setSaving(false);
    }
  };

  const runJob = async () => {
    if (!connector) return;
    setRunning(true);
    try {
      const res = await fetch('/api/integrations/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectorId: connector.id,
          domain: selectedDomain,
          direction: jobDirection,
          format: jobFormat,
          payloadName: jobDirection === 'import' ? `${selectedDomain}.${jobFormat}` : undefined,
          inputPayload: jobDirection === 'import' ? importPayload : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Sync job failed');
      setHub(data.hub);
      setToastMessage(data.job?.status === 'needs_review'
        ? (ka ? 'სინქრონიზაცია საჭიროებს გადახედვას.' : 'Sync job needs review.')
        : (ka ? 'სინქრონიზაცია დასრულდა.' : 'Sync job completed.'));
      if (data.job?.exportArtifact) downloadArtifact(data.job);
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : (ka ? 'დავალება ვერ შესრულდა' : 'Job failed')}`);
    } finally {
      setRunning(false);
    }
  };

  const testConnection = async () => {
    if (!connector) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/integrations/connectors/${connector.id}/test`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Connection test failed');
      setTestResult({ ok: true, message: data.probe?.message || (ka ? 'დაკავშირებულია.' : 'Connected.'), entitySets: data.probe?.entitySets || [] });
      setToastMessage(ka ? '1C-სთან კავშირის ტესტი წარმატებულია.' : '1C connection test succeeded.');
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : (ka ? 'კავშირის ტესტი ჩავარდა' : 'Connection test failed'), entitySets: [] });
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : (ka ? 'ტესტი ჩავარდა' : 'Test failed')}`);
    } finally {
      setTesting(false);
    }
  };

  const livePull = async () => {
    if (!connector || !liveEntitySet.trim()) return;
    setPulling(true);
    try {
      const res = await fetch('/api/integrations/jobs/live-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entitySet: liveEntitySet.trim(), domain: selectedDomain, top: 50 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Live pull failed');
      setHub(data.hub);
      setToastMessage(data.job?.status === 'needs_review'
        ? (ka ? 'პირდაპირი მოზიდვა საჭიროებს გადახედვას.' : 'Live pull needs review.')
        : (ka ? 'პირდაპირი მოზიდვა დასრულდა.' : 'Live pull completed.'));
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : (ka ? 'პირდაპირი მოზიდვა ჩავარდა' : 'Live pull failed')}`);
    } finally {
      setPulling(false);
    }
  };

  const retryJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/integrations/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Retry failed');
      setHub(data.hub);
      setToastMessage(ka ? 'დავალება ხელახლა გაეშვა.' : 'Sync job retried.');
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : (ka ? 'ხელახლა ცდა ჩავარდა' : 'Retry failed')}`);
    }
  };

  const saveMappings = async () => {
    if (!connector) return;
    const mappings = mappingRows
      .map((row) => ({
        ...row,
        domain: selectedDomain,
        direction: mappingDirection,
        localField: row.localField.trim(),
        externalField: row.externalField.trim(),
      }))
      .filter((row) => row.localField && row.externalField);

    try {
      const res = await fetch(`/api/integrations/connectors/${connector.id}/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Mapping save failed');
      setHub(data.hub);
      setToastMessage(ka ? 'ველების შესაბამისობა შენახულია.' : 'Field mappings saved.');
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : (ka ? 'შესაბამისობის შენახვა ჩავარდა' : 'Mapping save failed')}`);
    }
  };

  const resolveConflict = async (conflictId: string) => {
    const resolution = conflictNotes[conflictId]?.trim();
    if (!resolution) {
      setToastMessage(ka ? 'ჯერ დაამატეთ გადაწყვეტის შენიშვნა.' : 'Add a resolution note first.');
      return;
    }
    try {
      const res = await fetch(`/api/integrations/conflicts/${encodeURIComponent(conflictId)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Conflict resolution failed');
      setHub(data.hub);
      setConflictNotes((prev) => ({ ...prev, [conflictId]: '' }));
      setToastMessage(ka ? 'კონფლიქტი მოგვარებულად მოინიშნა.' : 'Conflict marked resolved.');
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : (ka ? 'მოგვარება ჩავარდა' : 'Resolution failed')}`);
    }
  };

  const updateMappingRow = (index: number, updates: Partial<FieldMappingInput>) => {
    setMappingRows((rows) => rows.map((row, i) => i === index ? { ...row, ...updates } : row));
  };

  if (loading) {
    return (
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6">
        <div className="flex items-center justify-center py-20 text-stone-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          {ka ? 'ინტეგრაციების ცენტრი იტვირთება' : 'Loading Integration Hub'}
        </div>
      </main>
    );
  }

  if (!hub || !connector) {
    return (
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6">
        <EmptyState icon={PlugZap} title={ka ? 'ინტეგრაციების ცენტრი მიუწვდომელია' : 'Integration Hub unavailable'} description={ka ? 'მიმდინარე სამუშაო სივრცემ ვერ ჩატვირთა ინტეგრაციის მდგომარეობა.' : 'The current workspace could not load integration state.'} />
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 space-y-4 font-sans text-stone-700 dark:text-stone-200">
      <PageHeader
        eyebrow={ka ? 'პარამეტრები / ადმინი' : 'Settings / Admin'}
        title={ka ? 'ინტეგრაციების ცენტრი' : 'Integration Hub'}
        description={ka ? 'ბუღალტრული და ERP სისტემების კონტროლირებადი სინქრონიზაცია, უსაფრთხო 1C საწყისით.' : 'Controlled synchronization for accounting and ERP systems, starting with a safe 1C placeholder.'}
        icon={DatabaseZap}
        actions={
          <ActionButton onClick={loadHub} tone="secondary">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            {ka ? 'განახლება' : 'Refresh'}
          </ActionButton>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <MetricCard
          label={ka ? 'კონექტორი' : 'Connector'}
          value={connector.enabled ? (ka ? 'ჩართული' : 'Enabled') : (ka ? 'გამორთული' : 'Disabled')}
          detail={connectorDisplayName(connector.displayName, lang)}
          icon={PlugZap}
          tone={connector.enabled ? 'success' : 'neutral'}
        />
        <MetricCard
          label={ka ? 'ბოლო სინქრონიზაცია' : 'Last sync'}
          value={connector.lastSuccessfulSyncAt ? (ka ? 'წარმატებული' : 'Successful') : (ka ? 'წარმატება არ ყოფილა' : 'No success')}
          detail={formatDate(connector.lastSyncAt || connector.lastSuccessfulSyncAt, ka)}
          icon={CheckCircle2}
          tone={connector.lastSuccessfulSyncAt ? 'success' : 'warning'}
        />
        <MetricCard
          label={ka ? 'რიგი' : 'Queue'}
          value={hub.jobs.length}
          detail={ka ? `${failedJobs.length} ჩავარდნილი ან გადასახედი` : `${failedJobs.length} failed or review`}
          icon={GitBranch}
          tone={failedJobs.length ? 'warning' : 'info'}
        />
        <MetricCard
          label={ka ? 'კონფლიქტები' : 'Conflicts'}
          value={openConflicts.length}
          detail={ka ? `${hub.externalRefs.length} გარე ID შესაბამისობა` : `${hub.externalRefs.length} external ID mappings`}
          icon={AlertTriangle}
          tone={openConflicts.length ? 'danger' : 'success'}
        />
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-[#e8dfd5] bg-white/90 p-2 dark:border-stone-800 dark:bg-stone-900/90">
        {[
          ['overview', ka ? 'მიმოხილვა' : 'Overview'],
          ['queue', ka ? 'რიგი და კონფლიქტები' : 'Queue & conflicts'],
          ['mappings', ka ? 'ველების შესაბამისობა' : 'Field mappings'],
          ['refs', ka ? 'გარე ID-ები' : 'External IDs'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActivePanel(id as typeof activePanel)}
            className={cx(
              'rounded-xl px-3 py-2 text-xs font-bold transition-colors cursor-pointer',
              activePanel === id
                ? 'bg-[#4e0e15] text-amber-50'
                : 'text-stone-500 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {activePanel === 'overview' && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] gap-4">
          <SectionCard
            title={ka ? '1C კონექტორი' : '1C Connector'}
            subtitle={ka ? 'ახლა ხელით JSON/CSV გაცვლა; API პარამეტრები მომავალი კონექტორისთვისაა.' : 'Manual JSON/CSV exchange now; API settings are placeholders for a future connector.'}
            icon={PlugZap}
          >
            <form onSubmit={saveConnector} className="space-y-4">
              <InlineNotice tone="warning">
                {ka
                  ? 'CellarFlow არ აზიარებს თავის ბაზას 1C-სთან. ბუღალტრულ აპლიკაციებს შეუძლიათ დააბრუნონ დოკუმენტის, გადახდის, შეფასების, დღგ/გადასახადის და ოფიციალური ID მეტამონაცემები ამ კონტროლირებადი ფენის მეშვეობით.'
                  : 'CellarFlow does not share its database with 1C. Accounting apps can return document, payment, valuation, VAT/tax, and official ID metadata through this controlled layer.'}
              </InlineNotice>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-950/40">
                  <span className="text-xs font-bold">{ka ? 'კონექტორი ჩართულია' : 'Connector enabled'}</span>
                  <input
                    name="enabled"
                    type="checkbox"
                    defaultChecked={connector.enabled}
                    className="h-4 w-4 accent-emerald-700"
                  />
                </label>
                <div>
                  <FieldLabel required>{ka ? 'ნაგულისხმევი ექსპორტის ფორმატი' : 'Default export format'}</FieldLabel>
                  <select name="defaultExportFormat" aria-label={ka ? 'ნაგულისხმევი ექსპორტის ფორმატი' : 'Default export format'} defaultValue={connector.defaultExportFormat} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                  </select>
                </div>
                <div>
                  <FieldLabel required>{ka ? 'გაცვლის რეჟიმი' : 'Exchange mode'}</FieldLabel>
                  <select name="exchangeMode" aria-label={ka ? 'გაცვლის რეჟიმი' : 'Exchange mode'} defaultValue={connector.exchangeMode} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                    <option value="manual_json_csv">{ka ? 'ფაილების ხელით გაცვლა' : 'Manual file exchange'}</option>
                    <option value="live_odata">{ka ? 'პირდაპირი OData (HTTPS)' : 'Live OData (HTTPS)'}</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <FieldLabel required>{ka ? 'Endpoint URL ან გაცვლის მისამართი' : 'Endpoint URL or exchange reference'}</FieldLabel>
                  <input
                    name="endpointUrl"
                    defaultValue={connector.endpointUrl}
                    placeholder={ka ? 'https://1c.example.local/exchange ან ხელით გაცვლის საქაღალდე' : 'https://1c.example.local/exchange or manual exchange folder'}
                    className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs outline-none focus:border-[#4e0e15] dark:border-stone-800 dark:bg-stone-950"
                  />
                </div>
                <div>
                  <FieldLabel required>{ka ? 'ავთენტიფიკაციის რეჟიმი' : 'Authentication mode'}</FieldLabel>
                  <select name="authMode" aria-label={ka ? 'ავთენტიფიკაციის რეჟიმი' : 'Authentication mode'} defaultValue={connector.authMode} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                    <option value="none">{ka ? 'არცერთი / ფაილების ხელით გაცვლა' : 'None / manual file exchange'}</option>
                    <option value="basic">{ka ? 'Basic (რეზერვი)' : 'Basic placeholder'}</option>
                    <option value="api_key">{ka ? 'API key (რეზერვი)' : 'API key placeholder'}</option>
                    <option value="bearer">{ka ? 'Bearer token (რეზერვი)' : 'Bearer token placeholder'}</option>
                    <option value="oauth_placeholder">{ka ? 'OAuth (რეზერვი)' : 'OAuth placeholder'}</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>{ka ? 'მომხმარებელი' : 'Username'}</FieldLabel>
                  <input name="username" aria-label={ka ? 'ინტეგრაციის მომხმარებელი' : 'Integration username'} defaultValue={connector.username || ''} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs outline-none dark:border-stone-800 dark:bg-stone-950" />
                </div>
                <div>
                  <FieldLabel>{ka ? '1C ბაზის სახელი' : '1C database name'}</FieldLabel>
                  <input name="databaseName" aria-label={ka ? '1C ბაზის სახელი' : '1C database name'} defaultValue={connector.databaseName || ''} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs outline-none dark:border-stone-800 dark:bg-stone-950" />
                </div>
                <div>
                  <FieldLabel>{ka ? 'საიდუმლო მნიშვნელობა' : 'Secret value'}</FieldLabel>
                  <input
                    type="password"
                    value={secretValue}
                    onChange={(e) => setSecretValue(e.target.value)}
                    placeholder={connector.secretConfigured ? (ka ? 'საიდუმლო უკვე კონფიგურირებულია' : 'Secret already marked configured') : (ka ? 'მხოლოდ ჩასაწერი ველი' : 'Write-only placeholder')}
                    className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs outline-none dark:border-stone-800 dark:bg-stone-950"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-stone-100 pt-3 dark:border-stone-800">
                <div className="text-[11px] text-stone-500">
                  {(() => {
                    const settings = definition
                      ? connectorSettingsDisplay(definition, lang)
                      : { requiredSettings: [], optionalSettings: [] };
                    const required = settings.requiredSettings.join(', ') || (ka ? 'endpoint/ავთენტიფიკაცია' : 'endpoint/auth mode');
                    const optional = settings.optionalSettings.join(', ') || (ka ? 'მომხმარებელი, ბაზის სახელი' : 'username, database name');
                    return `${ka ? 'სავალდებულო' : 'Required'}: ${required}. ${ka ? 'არჩევითი' : 'Optional'}: ${optional}.`;
                  })()}
                </div>
                <ActionButton type="submit" disabled={saving}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                  {ka ? 'შენახვა' : 'Save'}
                </ActionButton>
              </div>
            </form>
          </SectionCard>

          <SectionCard title={ka ? 'პირდაპირი 1C კავშირი' : 'Live 1C Connection'} subtitle={ka ? 'შეამოწმეთ OData endpoint და პირდაპირ მოზიდეთ ერთეულები.' : 'Test the OData endpoint and pull entities directly.'} icon={PlugZap}>
            <div className="space-y-4">
              <InlineNotice>
                {ka ? <>საჭიროა გაცვლის რეჟიმი <strong>Live OData</strong>, HTTPS endpoint და შენახული მონაცემები. მონაცემები დაცულია სერვერზე და არასდროს ტოვებს მას; endpoint მოწმდება პრივატულ/შიდა მისამართებზე ყოველ გამოძახებამდე.</> : <>Requires exchange mode <strong>Live OData</strong>, an HTTPS endpoint, and saved credentials. Credentials are sealed server-side and never leave the server; the endpoint is checked for private/internal addresses before every call.</>}
              </InlineNotice>
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton onClick={testConnection} disabled={testing || !connector?.enabled}>
                  {testing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />}
                  {ka ? 'კავშირის ტესტი' : 'Test Connection'}
                </ActionButton>
                {testResult && (
                  <span className={cx('text-[11px] font-bold', testResult.ok ? 'text-emerald-700 dark:text-emerald-500' : 'text-red-700 dark:text-red-400')}>
                    {testResult.ok ? '✓ ' : '✕ '}{testResult.message}
                  </span>
                )}
              </div>
              {testResult?.entitySets && testResult.entitySets.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {testResult.entitySets.slice(0, 24).map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setLiveEntitySet(name)}
                      className="rounded-lg border border-[#e8dfd5] bg-white px-2 py-1 text-[10px] font-mono font-bold text-stone-600 hover:border-[#4e0e15] dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                <div>
                  <FieldLabel>{ka ? 'OData ერთეულთა ნაკრები' : 'OData entity set'}</FieldLabel>
                  <input
                    value={liveEntitySet}
                    onChange={(e) => setLiveEntitySet(e.target.value)}
                    placeholder="Catalog_Номенклатура"
                    aria-label={ka ? 'OData ერთეულთა ნაკრები' : 'OData entity set'}
                    className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-mono outline-none focus:border-[#4e0e15] dark:border-stone-800 dark:bg-stone-950"
                  />
                </div>
                <ActionButton onClick={livePull} disabled={pulling || !liveEntitySet.trim()}>
                  {pulling ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ArrowDownToLine className="w-3.5 h-3.5 mr-1.5" />}
                  {ka ? `მოზიდვა → ${selectedDomain}` : `Pull into ${selectedDomain}`}
                </ActionButton>
              </div>
            </div>
          </SectionCard>

          <SectionCard title={ka ? 'ხელით გაცვლა' : 'Manual Exchange'} subtitle={ka ? 'შექმენით კონტროლირებადი ექსპორტის/იმპორტის დავალებები.' : 'Create controlled export/import jobs.'} icon={FileJson}>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <FieldLabel required>{ka ? 'დომენი' : 'Domain'}</FieldLabel>
                  <select aria-label={ka ? 'სინქრონიზაციის დომენი' : 'Sync domain'} value={selectedDomain} onChange={(e) => setSelectedDomain(e.target.value as IntegrationSyncDomain)} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                    {domains.map((domain) => <option key={domain.id} value={domain.id}>{integrationDomainLabel(domain, lang)}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel required>{ka ? 'ფორმატი' : 'Format'}</FieldLabel>
                  <select aria-label={ka ? 'დავალების ფორმატი' : 'Job format'} value={jobFormat} onChange={(e) => setJobFormat(e.target.value as IntegrationSyncFormat)} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['export', 'import'] as IntegrationSyncDirection[]).map((direction) => (
                  <button
                    key={direction}
                    type="button"
                    onClick={() => setJobDirection(direction)}
                    className={cx(
                      'rounded-xl border px-3 py-2 text-xs font-bold cursor-pointer transition-colors',
                      jobDirection === direction
                        ? 'border-[#4e0e15] bg-[#4e0e15] text-white'
                        : 'border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300',
                    )}
                  >
                    {direction === 'export' ? <ArrowUpFromLine className="inline w-3.5 h-3.5 mr-1" /> : <ArrowDownToLine className="inline w-3.5 h-3.5 mr-1" />}
                    {dirLabel(direction)}
                  </button>
                ))}
              </div>
              {jobDirection === 'import' && (
                <div>
                  <FieldLabel required>{ka ? 'იმპორტის მონაცემები' : 'Import payload'}</FieldLabel>
                  <textarea
                    value={importPayload}
                    onChange={(e) => setImportPayload(e.target.value)}
                    rows={8}
                    placeholder={jobFormat === 'json' ? '{"records":[{"localId":"...","externalId":"...","documentNumber":"..."}]}' : 'localId,externalId,documentNumber'}
                    className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 font-mono text-[11px] outline-none dark:border-stone-800 dark:bg-stone-950"
                  />
                </div>
              )}
              <ActionButton onClick={runJob} disabled={running || !connector.enabled || (jobDirection === 'import' && !importPayload.trim())} className="w-full">
                {running ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <DatabaseZap className="w-3.5 h-3.5 mr-1.5" />}
                {ka ? `გაშვება: ${dirLabel(jobDirection)}` : `Run ${jobDirection}`}
              </ActionButton>
              {lastJob?.exportArtifact && (
                <button
                  type="button"
                  onClick={() => downloadArtifact(lastJob)}
                  className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300"
                >
                  {ka ? `ბოლო ${lastJob.exportArtifact.format.toUpperCase()} ექსპორტის ჩამოტვირთვა` : `Download latest ${lastJob.exportArtifact.format.toUpperCase()} export`}
                </button>
              )}
            </div>
          </SectionCard>

          <SectionCard title={ka ? 'ჭეშმარიტების წყარო' : 'Source Of Truth'} icon={ShieldCheck} className="xl:col-span-2">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {Object.values(sourceOfTruth).map((rule) => {
                const ruleText = sourceOfTruthDisplay(rule, lang);
                return (
                <div key={rule.domain} className="rounded-xl border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-950/30">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-black uppercase text-stone-800 dark:text-amber-100">{integrationDomainLabel(rule.domain, lang)}</span>
                    <StatusBadge tone="info">{rule.domain}</StatusBadge>
                  </div>
                  <p className="text-[11px] leading-relaxed text-stone-500">{ruleText.notes}</p>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded-lg bg-white p-2 dark:bg-stone-900">
                      <strong className="block text-emerald-700 dark:text-emerald-300">{ka ? 'CellarFlow ფლობს' : 'CellarFlow owns'}</strong>
                      {ruleText.cellarFlowOwns.join(', ')}
                    </div>
                    <div className="rounded-lg bg-white p-2 dark:bg-stone-900">
                      <strong className="block text-sky-700 dark:text-sky-300">{ka ? '1C ფლობს' : '1C owns'}</strong>
                      {ruleText.externalOwns.join(', ')}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </SectionCard>
        </div>
      )}

      {activePanel === 'queue' && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4">
          <SectionCard title={ka ? 'სინქრონიზაციის რიგი და ისტორია' : 'Sync Queue & History'} icon={RefreshCw}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[9px] uppercase tracking-widest text-stone-500 dark:text-stone-400">
                  <tr className="border-b border-stone-200 dark:border-stone-800">
                    <th className="py-2 pr-3">{ka ? 'დავალება' : 'Job'}</th>
                    <th className="py-2 pr-3">{ka ? 'დომენი' : 'Domain'}</th>
                    <th className="py-2 pr-3">{ka ? 'მიმართულება' : 'Direction'}</th>
                    <th className="py-2 pr-3">{ka ? 'სტატუსი' : 'Status'}</th>
                    <th className="py-2 pr-3">{ka ? 'ჩანაწერები' : 'Records'}</th>
                    <th className="py-2 pr-3">{ka ? 'განახლდა' : 'Updated'}</th>
                    <th className="py-2 text-right">{ka ? 'ქმედება' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {hub.jobs.map((job) => (
                    <tr key={job.id}>
                      <td className="py-2 pr-3 font-mono text-[10px] text-stone-500">{job.id}</td>
                      <td className="py-2 pr-3 font-bold">{integrationDomainLabel(job.domain, lang)}</td>
                      <td className="py-2 pr-3">{dirLabel(job.direction)}</td>
                      <td className="py-2 pr-3"><StatusBadge tone={statusTone(job.status)}>{job.status}</StatusBadge></td>
                      <td className="py-2 pr-3">{job.resultSummary?.recordCount ?? '-'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(job.updatedAt, ka)}</td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-2">
                          {job.exportArtifact && (
                            <button type="button" onClick={() => downloadArtifact(job)} className="rounded-lg bg-stone-100 px-2 py-1 text-[10px] font-bold text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200">{ka ? 'ჩამოტვირთვა' : 'Download'}</button>
                          )}
                          {(job.status === 'failed' || job.status === 'needs_review') && (
                            <button type="button" onClick={() => retryJob(job.id)} className="rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900 hover:bg-amber-200 dark:bg-amber-950/30 dark:text-amber-300">
                              <RotateCcw className="inline h-3 w-3 mr-1" />
                              {ka ? 'ხელახლა' : 'Retry'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hub.jobs.length === 0 && <EmptyState icon={RefreshCw} title={ka ? 'სინქრონიზაციის დავალებები ჯერ არ არის' : 'No sync jobs yet'} />}
            </div>
          </SectionCard>

          <SectionCard title={ka ? 'კონფლიქტები' : 'Conflicts'} icon={AlertTriangle}>
            <div className="space-y-3">
              {openConflicts.length === 0 && <EmptyState icon={CheckCircle2} title={ka ? 'ღია კონფლიქტები არ არის' : 'No open conflicts'} />}
              {openConflicts.map((conflict) => (
                <div key={conflict.id} className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900 dark:bg-rose-950/20">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <strong className="block text-xs text-rose-900 dark:text-rose-200">{integrationDomainLabel(conflict.domain, lang)}</strong>
                      <span className="text-[10px] text-rose-700 dark:text-rose-300">{conflict.reason}</span>
                    </div>
                    <StatusBadge tone="danger">{ka ? 'ღია' : 'open'}</StatusBadge>
                  </div>
                  {conflict.fieldPath && (
                    <div className="mt-2 rounded-lg bg-white p-2 text-[10px] dark:bg-stone-900">
                      <strong>{conflict.fieldPath}</strong>
                      <div className="mt-1 grid grid-cols-2 gap-2 font-mono text-stone-500">
                        <span>CellarFlow: {JSON.stringify(conflict.localValue)}</span>
                        <span>{ka ? 'გარე' : 'External'}: {JSON.stringify(conflict.externalValue)}</span>
                      </div>
                    </div>
                  )}
                  <textarea
                    value={conflictNotes[conflict.id] || ''}
                    onChange={(e) => setConflictNotes((prev) => ({ ...prev, [conflict.id]: e.target.value }))}
                    rows={2}
                    placeholder={ka ? 'გადაწყვეტის შენიშვნა' : 'Resolution note'}
                    className="mt-2 w-full rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] outline-none dark:border-rose-900 dark:bg-stone-950"
                  />
                  <button
                    type="button"
                    onClick={() => resolveConflict(conflict.id)}
                    className="mt-2 w-full rounded-lg bg-rose-700 px-3 py-1.5 text-[10px] font-bold uppercase text-white hover:bg-rose-800"
                  >
                    {ka ? 'მოგვარებულად მონიშვნა' : 'Mark resolved'}
                  </button>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={ka ? 'მოვლენები' : 'Events'} icon={GitBranch} className="xl:col-span-2">
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {hub.events.slice(0, 60).map((event: IntegrationSyncEvent) => (
                    <tr key={event.id}>
                      <td className="py-2 pr-3 whitespace-nowrap text-[10px] text-stone-500 dark:text-stone-400">{formatDate(event.createdAt, ka)}</td>
                      <td className="py-2 pr-3"><StatusBadge tone={event.level === 'error' ? 'danger' : event.level === 'warning' ? 'warning' : 'info'}>{event.level}</StatusBadge></td>
                      <td className="py-2 pr-3 font-bold">{event.action}</td>
                      <td className="py-2 text-stone-500">{event.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hub.events.length === 0 && <EmptyState icon={GitBranch} title={ka ? 'მოვლენები არ არის ჩაწერილი' : 'No events recorded'} />}
            </div>
          </SectionCard>
        </div>
      )}

      {activePanel === 'mappings' && (
        <SectionCard
          title={ka ? 'ველების შესაბამისობა' : 'Field Mappings'}
          subtitle={ka ? 'შესაბამისობა თარგმნის ხელით გაცვლის ფაილებს გარე ბაზაზე წვდომის მინიჭების გარეშე.' : 'Mappings translate manual exchange files without granting external database access.'}
          icon={GitBranch}
          actions={<ActionButton onClick={saveMappings}><Save className="w-3.5 h-3.5 mr-1.5" />{ka ? 'შესაბამისობის შენახვა' : 'Save mappings'}</ActionButton>}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel required>{ka ? 'დომენი' : 'Domain'}</FieldLabel>
                <select aria-label={ka ? 'სინქრონიზაციის დომენი' : 'Sync domain'} value={selectedDomain} onChange={(e) => setSelectedDomain(e.target.value as IntegrationSyncDomain)} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                  {domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.label}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel required>{ka ? 'მიმართულება' : 'Direction'}</FieldLabel>
                <select aria-label={ka ? 'შესაბამისობის მიმართულება' : 'Mapping direction'} value={mappingDirection} onChange={(e) => setMappingDirection(e.target.value as IntegrationSyncDirection)} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                  <option value="export">{ka ? 'ექსპორტი' : 'Export'}</option>
                  <option value="import">{ka ? 'იმპორტი' : 'Import'}</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[9px] uppercase tracking-widest text-stone-500 dark:text-stone-400">
                  <tr className="border-b border-stone-200 dark:border-stone-800">
                    <th className="py-2 pr-3">{ka ? 'CellarFlow ველი' : 'CellarFlow field'}</th>
                    <th className="py-2 pr-3">{ka ? 'გარე ველი' : 'External field'}</th>
                    <th className="py-2 pr-3">{ka ? 'გარდაქმნა' : 'Transform'}</th>
                    <th className="py-2">{ka ? 'სავალდებულო' : 'Required'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {mappingRows.map((row, index) => (
                    <tr key={index}>
                      <td className="py-2 pr-3">
                        <input value={row.localField} onChange={(e) => updateMappingRow(index, { localField: e.target.value })} className="w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs outline-none dark:border-stone-800 dark:bg-stone-950" />
                      </td>
                      <td className="py-2 pr-3">
                        <input value={row.externalField} onChange={(e) => updateMappingRow(index, { externalField: e.target.value })} className="w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs outline-none dark:border-stone-800 dark:bg-stone-950" />
                      </td>
                      <td className="py-2 pr-3">
                        <select aria-label={ka ? 'ველის გარდაქმნა' : 'Field transform'} value={row.transform || 'none'} onChange={(e) => updateMappingRow(index, { transform: e.target.value as IntegrationFieldMapping['transform'] })} className="w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs outline-none dark:border-stone-800 dark:bg-stone-950">
                          <option value="none">{ka ? 'არცერთი' : 'None'}</option>
                          <option value="string">{ka ? 'ტექსტი' : 'String'}</option>
                          <option value="number">{ka ? 'რიცხვი' : 'Number'}</option>
                          <option value="date">{ka ? 'თარიღი' : 'Date'}</option>
                          <option value="boolean">{ka ? 'ლოგიკური' : 'Boolean'}</option>
                        </select>
                      </td>
                      <td className="py-2">
                        <input type="checkbox" checked={Boolean(row.required)} onChange={(e) => updateMappingRow(index, { required: e.target.checked })} className="h-4 w-4 accent-[#4e0e15]" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => setMappingRows((rows) => [...rows, { domain: selectedDomain, direction: mappingDirection, localField: '', externalField: '', required: false, transform: 'none' }])}
              className="rounded-xl bg-stone-100 px-3 py-2 text-xs font-bold text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200"
            >
              {ka ? 'შესაბამისობის რიგის დამატება' : 'Add mapping row'}
            </button>
          </div>
        </SectionCard>
      )}

      {activePanel === 'refs' && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
          <SectionCard title={ka ? 'გარე ID მითითებები' : 'External ID References'} icon={GitBranch}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[9px] uppercase tracking-widest text-stone-500 dark:text-stone-400">
                  <tr className="border-b border-stone-200 dark:border-stone-800">
                    <th className="py-2 pr-3">{ka ? 'დომენი' : 'Domain'}</th>
                    <th className="py-2 pr-3">{ka ? 'ლოკალური ID' : 'Local ID'}</th>
                    <th className="py-2 pr-3">{ka ? 'გარე ID' : 'External ID'}</th>
                    <th className="py-2 pr-3">{ka ? 'ჩვენება' : 'Display'}</th>
                    <th className="py-2">{ka ? 'განახლდა' : 'Updated'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {hub.externalRefs.map((ref: IntegrationExternalReference) => (
                    <tr key={ref.id}>
                      <td className="py-2 pr-3 font-bold">{integrationDomainLabel(ref.domain, lang)}</td>
                      <td className="py-2 pr-3 font-mono text-[10px]">{ref.localId}</td>
                      <td className="py-2 pr-3 font-mono text-[10px]">{ref.externalId}</td>
                      <td className="py-2 pr-3">{ref.displayName || '-'}</td>
                      <td className="py-2 whitespace-nowrap">{formatDate(ref.updatedAt, ka)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hub.externalRefs.length === 0 && <EmptyState icon={GitBranch} title={ka ? 'გარე ID-ები ჯერ არ არის შესაბამისობაში' : 'No external IDs mapped yet'} />}
            </div>
          </SectionCard>
          <FormSection
            title={ka ? 'ბუღალტრული მეტამონაცემები' : 'Accounting Metadata'}
            description={ka ? 'გარე მითითებები ინახავს ოფიციალურ ID-ებსა და ბუღალტრულ სტატუსს მარნის მონაცემების გადაწერის გარეშე.' : 'External references store official IDs and accounting status without rewriting cellar facts.'}
            icon={ShieldCheck}
          >
            <div className="space-y-2">
              {hub.externalRefs.slice(0, 6).map((ref) => (
                <div key={ref.id} className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-xs">{ref.displayName || ref.localId}</strong>
                    <StatusBadge tone="brand">{integrationDomainLabel(ref.domain, lang)}</StatusBadge>
                  </div>
                  <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-stone-50 p-2 text-[10px] text-stone-500 dark:bg-stone-950">
                    {JSON.stringify(ref.accounting || {}, null, 2)}
                  </pre>
                </div>
              ))}
              {hub.externalRefs.length === 0 && <InlineNotice tone="neutral">{ka ? 'გარე ID-ები გამოჩნდება წარმატებული ხელით იმპორტის შემდეგ.' : 'External IDs appear after a successful manual import.'}</InlineNotice>}
            </div>
          </FormSection>
        </div>
      )}
    </main>
  );
}
