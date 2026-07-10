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

interface IntegrationHubTabProps {
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

function formatDate(value?: string | null): string {
  if (!value) return 'Not yet';
  try {
    return new Date(value).toLocaleString();
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

export default function IntegrationHubTab({ setToastMessage }: IntegrationHubTabProps) {
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
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : 'Load failed'}`);
    } finally {
      setLoading(false);
    }
  }, [setToastMessage]);

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
      setToastMessage('Integration connector saved.');
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : 'Save failed'}`);
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
      setToastMessage(data.job?.status === 'needs_review' ? 'Sync job needs review.' : 'Sync job completed.');
      if (data.job?.exportArtifact) downloadArtifact(data.job);
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : 'Job failed'}`);
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
      setTestResult({ ok: true, message: data.probe?.message || 'Connected.', entitySets: data.probe?.entitySets || [] });
      setToastMessage('1C connection test succeeded.');
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Connection test failed', entitySets: [] });
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : 'Test failed'}`);
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
      setToastMessage(data.job?.status === 'needs_review' ? 'Live pull needs review.' : 'Live pull completed.');
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : 'Live pull failed'}`);
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
      setToastMessage('Sync job retried.');
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : 'Retry failed'}`);
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
      setToastMessage('Field mappings saved.');
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : 'Mapping save failed'}`);
    }
  };

  const resolveConflict = async (conflictId: string) => {
    const resolution = conflictNotes[conflictId]?.trim();
    if (!resolution) {
      setToastMessage('Add a resolution note first.');
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
      setToastMessage('Conflict marked resolved.');
    } catch (err) {
      setToastMessage(`Integration Hub: ${err instanceof Error ? err.message : 'Resolution failed'}`);
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
          Loading Integration Hub
        </div>
      </main>
    );
  }

  if (!hub || !connector) {
    return (
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6">
        <EmptyState icon={PlugZap} title="Integration Hub unavailable" description="The current workspace could not load integration state." />
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 space-y-4 font-sans text-stone-700 dark:text-stone-200">
      <PageHeader
        eyebrow="Settings / Admin"
        title="Integration Hub"
        description="Controlled synchronization for accounting and ERP systems, starting with a safe 1C placeholder."
        icon={DatabaseZap}
        actions={
          <ActionButton onClick={loadHub} tone="secondary">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </ActionButton>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <MetricCard
          label="Connector"
          value={connector.enabled ? 'Enabled' : 'Disabled'}
          detail={connector.displayName}
          icon={PlugZap}
          tone={connector.enabled ? 'success' : 'neutral'}
        />
        <MetricCard
          label="Last sync"
          value={connector.lastSuccessfulSyncAt ? 'Successful' : 'No success'}
          detail={formatDate(connector.lastSyncAt || connector.lastSuccessfulSyncAt)}
          icon={CheckCircle2}
          tone={connector.lastSuccessfulSyncAt ? 'success' : 'warning'}
        />
        <MetricCard
          label="Queue"
          value={hub.jobs.length}
          detail={`${failedJobs.length} failed or review`}
          icon={GitBranch}
          tone={failedJobs.length ? 'warning' : 'info'}
        />
        <MetricCard
          label="Conflicts"
          value={openConflicts.length}
          detail={`${hub.externalRefs.length} external ID mappings`}
          icon={AlertTriangle}
          tone={openConflicts.length ? 'danger' : 'success'}
        />
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-[#e8dfd5] bg-white/90 p-2 dark:border-stone-800 dark:bg-stone-900/90">
        {[
          ['overview', 'Overview'],
          ['queue', 'Queue & conflicts'],
          ['mappings', 'Field mappings'],
          ['refs', 'External IDs'],
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
            title="1C Connector"
            subtitle="Manual JSON/CSV exchange now; API settings are placeholders for a future connector."
            icon={PlugZap}
          >
            <form onSubmit={saveConnector} className="space-y-4">
              <InlineNotice tone="warning">
                CellarFlow does not share its database with 1C. Accounting apps can return document, payment, valuation, VAT/tax, and official ID metadata through this controlled layer.
              </InlineNotice>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-950/40">
                  <span className="text-xs font-bold">Connector enabled</span>
                  <input
                    name="enabled"
                    type="checkbox"
                    defaultChecked={connector.enabled}
                    className="h-4 w-4 accent-emerald-700"
                  />
                </label>
                <div>
                  <FieldLabel required>Default export format</FieldLabel>
                  <select name="defaultExportFormat" aria-label="Default export format" defaultValue={connector.defaultExportFormat} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                  </select>
                </div>
                <div>
                  <FieldLabel required>Exchange mode</FieldLabel>
                  <select name="exchangeMode" aria-label="Exchange mode" defaultValue={connector.exchangeMode} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                    <option value="manual_json_csv">Manual file exchange</option>
                    <option value="live_odata">Live OData (HTTPS)</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <FieldLabel required>Endpoint URL or exchange reference</FieldLabel>
                  <input
                    name="endpointUrl"
                    defaultValue={connector.endpointUrl}
                    placeholder="https://1c.example.local/exchange or manual exchange folder"
                    className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs outline-none focus:border-[#4e0e15] dark:border-stone-800 dark:bg-stone-950"
                  />
                </div>
                <div>
                  <FieldLabel required>Authentication mode</FieldLabel>
                  <select name="authMode" aria-label="Authentication mode" defaultValue={connector.authMode} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                    <option value="none">None / manual file exchange</option>
                    <option value="basic">Basic placeholder</option>
                    <option value="api_key">API key placeholder</option>
                    <option value="bearer">Bearer token placeholder</option>
                    <option value="oauth_placeholder">OAuth placeholder</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>Username</FieldLabel>
                  <input name="username" aria-label="Integration username" defaultValue={connector.username || ''} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs outline-none dark:border-stone-800 dark:bg-stone-950" />
                </div>
                <div>
                  <FieldLabel>1C database name</FieldLabel>
                  <input name="databaseName" aria-label="1C database name" defaultValue={connector.databaseName || ''} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs outline-none dark:border-stone-800 dark:bg-stone-950" />
                </div>
                <div>
                  <FieldLabel>Secret value</FieldLabel>
                  <input
                    type="password"
                    value={secretValue}
                    onChange={(e) => setSecretValue(e.target.value)}
                    placeholder={connector.secretConfigured ? 'Secret already marked configured' : 'Write-only placeholder'}
                    className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs outline-none dark:border-stone-800 dark:bg-stone-950"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-stone-100 pt-3 dark:border-stone-800">
                <div className="text-[11px] text-stone-500">
                  Required: {definition?.requiredSettings.join(', ') || 'endpoint/auth mode'}. Optional: {definition?.optionalSettings.join(', ') || 'username, database name'}.
                </div>
                <ActionButton type="submit" disabled={saving}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                  Save
                </ActionButton>
              </div>
            </form>
          </SectionCard>

          <SectionCard title="Live 1C Connection" subtitle="Test the OData endpoint and pull entities directly." icon={PlugZap}>
            <div className="space-y-4">
              <InlineNotice>
                Requires exchange mode <strong>Live OData</strong>, an HTTPS endpoint, and saved credentials.
                Credentials are sealed server-side and never leave the server; the endpoint is checked for
                private/internal addresses before every call.
              </InlineNotice>
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton onClick={testConnection} disabled={testing || !connector?.enabled}>
                  {testing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />}
                  Test Connection
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
                  <FieldLabel>OData entity set</FieldLabel>
                  <input
                    value={liveEntitySet}
                    onChange={(e) => setLiveEntitySet(e.target.value)}
                    placeholder="Catalog_Номенклатура"
                    aria-label="OData entity set"
                    className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-mono outline-none focus:border-[#4e0e15] dark:border-stone-800 dark:bg-stone-950"
                  />
                </div>
                <ActionButton onClick={livePull} disabled={pulling || !liveEntitySet.trim()}>
                  {pulling ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ArrowDownToLine className="w-3.5 h-3.5 mr-1.5" />}
                  Pull into {selectedDomain}
                </ActionButton>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Manual Exchange" subtitle="Create controlled export/import jobs." icon={FileJson}>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <FieldLabel required>Domain</FieldLabel>
                  <select aria-label="Sync domain" value={selectedDomain} onChange={(e) => setSelectedDomain(e.target.value as IntegrationSyncDomain)} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                    {domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.label}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel required>Format</FieldLabel>
                  <select aria-label="Job format" value={jobFormat} onChange={(e) => setJobFormat(e.target.value as IntegrationSyncFormat)} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
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
                    {direction}
                  </button>
                ))}
              </div>
              {jobDirection === 'import' && (
                <div>
                  <FieldLabel required>Import payload</FieldLabel>
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
                Run {jobDirection}
              </ActionButton>
              {lastJob?.exportArtifact && (
                <button
                  type="button"
                  onClick={() => downloadArtifact(lastJob)}
                  className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300"
                >
                  Download latest {lastJob.exportArtifact.format.toUpperCase()} export
                </button>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Source Of Truth" icon={ShieldCheck} className="xl:col-span-2">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {Object.values(sourceOfTruth).map((rule) => (
                <div key={rule.domain} className="rounded-xl border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-950/30">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-black uppercase text-stone-800 dark:text-amber-100">{domains.find((domain) => domain.id === rule.domain)?.label || rule.domain}</span>
                    <StatusBadge tone="info">{rule.domain}</StatusBadge>
                  </div>
                  <p className="text-[11px] leading-relaxed text-stone-500">{rule.notes}</p>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded-lg bg-white p-2 dark:bg-stone-900">
                      <strong className="block text-emerald-700 dark:text-emerald-300">CellarFlow owns</strong>
                      {rule.cellarFlowOwns.join(', ')}
                    </div>
                    <div className="rounded-lg bg-white p-2 dark:bg-stone-900">
                      <strong className="block text-sky-700 dark:text-sky-300">1C owns</strong>
                      {rule.externalOwns.join(', ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {activePanel === 'queue' && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4">
          <SectionCard title="Sync Queue & History" icon={RefreshCw}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[9px] uppercase tracking-widest text-stone-500 dark:text-stone-400">
                  <tr className="border-b border-stone-200 dark:border-stone-800">
                    <th className="py-2 pr-3">Job</th>
                    <th className="py-2 pr-3">Domain</th>
                    <th className="py-2 pr-3">Direction</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Records</th>
                    <th className="py-2 pr-3">Updated</th>
                    <th className="py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {hub.jobs.map((job) => (
                    <tr key={job.id}>
                      <td className="py-2 pr-3 font-mono text-[10px] text-stone-500">{job.id}</td>
                      <td className="py-2 pr-3 font-bold">{job.domain}</td>
                      <td className="py-2 pr-3">{job.direction}</td>
                      <td className="py-2 pr-3"><StatusBadge tone={statusTone(job.status)}>{job.status}</StatusBadge></td>
                      <td className="py-2 pr-3">{job.resultSummary?.recordCount ?? '-'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(job.updatedAt)}</td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-2">
                          {job.exportArtifact && (
                            <button type="button" onClick={() => downloadArtifact(job)} className="rounded-lg bg-stone-100 px-2 py-1 text-[10px] font-bold text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200">Download</button>
                          )}
                          {(job.status === 'failed' || job.status === 'needs_review') && (
                            <button type="button" onClick={() => retryJob(job.id)} className="rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900 hover:bg-amber-200 dark:bg-amber-950/30 dark:text-amber-300">
                              <RotateCcw className="inline h-3 w-3 mr-1" />
                              Retry
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hub.jobs.length === 0 && <EmptyState icon={RefreshCw} title="No sync jobs yet" />}
            </div>
          </SectionCard>

          <SectionCard title="Conflicts" icon={AlertTriangle}>
            <div className="space-y-3">
              {openConflicts.length === 0 && <EmptyState icon={CheckCircle2} title="No open conflicts" />}
              {openConflicts.map((conflict) => (
                <div key={conflict.id} className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900 dark:bg-rose-950/20">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <strong className="block text-xs text-rose-900 dark:text-rose-200">{conflict.domain}</strong>
                      <span className="text-[10px] text-rose-700 dark:text-rose-300">{conflict.reason}</span>
                    </div>
                    <StatusBadge tone="danger">open</StatusBadge>
                  </div>
                  {conflict.fieldPath && (
                    <div className="mt-2 rounded-lg bg-white p-2 text-[10px] dark:bg-stone-900">
                      <strong>{conflict.fieldPath}</strong>
                      <div className="mt-1 grid grid-cols-2 gap-2 font-mono text-stone-500">
                        <span>CellarFlow: {JSON.stringify(conflict.localValue)}</span>
                        <span>External: {JSON.stringify(conflict.externalValue)}</span>
                      </div>
                    </div>
                  )}
                  <textarea
                    value={conflictNotes[conflict.id] || ''}
                    onChange={(e) => setConflictNotes((prev) => ({ ...prev, [conflict.id]: e.target.value }))}
                    rows={2}
                    placeholder="Resolution note"
                    className="mt-2 w-full rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] outline-none dark:border-rose-900 dark:bg-stone-950"
                  />
                  <button
                    type="button"
                    onClick={() => resolveConflict(conflict.id)}
                    className="mt-2 w-full rounded-lg bg-rose-700 px-3 py-1.5 text-[10px] font-bold uppercase text-white hover:bg-rose-800"
                  >
                    Mark resolved
                  </button>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Events" icon={GitBranch} className="xl:col-span-2">
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {hub.events.slice(0, 60).map((event: IntegrationSyncEvent) => (
                    <tr key={event.id}>
                      <td className="py-2 pr-3 whitespace-nowrap text-[10px] text-stone-500 dark:text-stone-400">{formatDate(event.createdAt)}</td>
                      <td className="py-2 pr-3"><StatusBadge tone={event.level === 'error' ? 'danger' : event.level === 'warning' ? 'warning' : 'info'}>{event.level}</StatusBadge></td>
                      <td className="py-2 pr-3 font-bold">{event.action}</td>
                      <td className="py-2 text-stone-500">{event.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hub.events.length === 0 && <EmptyState icon={GitBranch} title="No events recorded" />}
            </div>
          </SectionCard>
        </div>
      )}

      {activePanel === 'mappings' && (
        <SectionCard
          title="Field Mappings"
          subtitle="Mappings translate manual exchange files without granting external database access."
          icon={GitBranch}
          actions={<ActionButton onClick={saveMappings}><Save className="w-3.5 h-3.5 mr-1.5" />Save mappings</ActionButton>}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel required>Domain</FieldLabel>
                <select aria-label="Sync domain" value={selectedDomain} onChange={(e) => setSelectedDomain(e.target.value as IntegrationSyncDomain)} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                  {domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.label}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel required>Direction</FieldLabel>
                <select aria-label="Mapping direction" value={mappingDirection} onChange={(e) => setMappingDirection(e.target.value as IntegrationSyncDirection)} className="w-full rounded-xl border border-[#e8dfd5] bg-white px-3 py-2 text-xs font-bold outline-none dark:border-stone-800 dark:bg-stone-950">
                  <option value="export">Export</option>
                  <option value="import">Import</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[9px] uppercase tracking-widest text-stone-500 dark:text-stone-400">
                  <tr className="border-b border-stone-200 dark:border-stone-800">
                    <th className="py-2 pr-3">CellarFlow field</th>
                    <th className="py-2 pr-3">External field</th>
                    <th className="py-2 pr-3">Transform</th>
                    <th className="py-2">Required</th>
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
                        <select aria-label="Field transform" value={row.transform || 'none'} onChange={(e) => updateMappingRow(index, { transform: e.target.value as IntegrationFieldMapping['transform'] })} className="w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs outline-none dark:border-stone-800 dark:bg-stone-950">
                          <option value="none">None</option>
                          <option value="string">String</option>
                          <option value="number">Number</option>
                          <option value="date">Date</option>
                          <option value="boolean">Boolean</option>
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
              Add mapping row
            </button>
          </div>
        </SectionCard>
      )}

      {activePanel === 'refs' && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
          <SectionCard title="External ID References" icon={GitBranch}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[9px] uppercase tracking-widest text-stone-500 dark:text-stone-400">
                  <tr className="border-b border-stone-200 dark:border-stone-800">
                    <th className="py-2 pr-3">Domain</th>
                    <th className="py-2 pr-3">Local ID</th>
                    <th className="py-2 pr-3">External ID</th>
                    <th className="py-2 pr-3">Display</th>
                    <th className="py-2">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {hub.externalRefs.map((ref: IntegrationExternalReference) => (
                    <tr key={ref.id}>
                      <td className="py-2 pr-3 font-bold">{ref.domain}</td>
                      <td className="py-2 pr-3 font-mono text-[10px]">{ref.localId}</td>
                      <td className="py-2 pr-3 font-mono text-[10px]">{ref.externalId}</td>
                      <td className="py-2 pr-3">{ref.displayName || '-'}</td>
                      <td className="py-2 whitespace-nowrap">{formatDate(ref.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hub.externalRefs.length === 0 && <EmptyState icon={GitBranch} title="No external IDs mapped yet" />}
            </div>
          </SectionCard>
          <FormSection
            title="Accounting Metadata"
            description="External references store official IDs and accounting status without rewriting cellar facts."
            icon={ShieldCheck}
          >
            <div className="space-y-2">
              {hub.externalRefs.slice(0, 6).map((ref) => (
                <div key={ref.id} className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-xs">{ref.displayName || ref.localId}</strong>
                    <StatusBadge tone="brand">{ref.domain}</StatusBadge>
                  </div>
                  <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-stone-50 p-2 text-[10px] text-stone-500 dark:bg-stone-950">
                    {JSON.stringify(ref.accounting || {}, null, 2)}
                  </pre>
                </div>
              ))}
              {hub.externalRefs.length === 0 && <InlineNotice tone="neutral">External IDs appear after a successful manual import.</InlineNotice>}
            </div>
          </FormSection>
        </div>
      )}
    </main>
  );
}
