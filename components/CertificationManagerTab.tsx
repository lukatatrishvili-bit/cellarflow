import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  ClipboardList,
  Compass,
  Download,
  ExternalLink,
  FileText,
  Package,
  UploadCloud,
  Save,
  TestTube,
  Trash2,
  Wine,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import DateInput from './ui/DateInput';
import type {
  BottlingRunRecord,
  CertificationApplicationStatus,
  CertificationProductType,
  CertificationRecord,
  GrapeIntakeRecord,
  LabAnalysis,
  MarketStatus,
  VineyardBlock,
  WineLot,
  DocumentAttachment,
} from '../lib/wineryState';
import { isActiveHarvestIntake } from '../lib/harvestIntakeIntegrity';
import { evaluateCertificationChecklist, requiredLabParameters } from '../lib/certification';
import { isActiveBottlingRun } from '../lib/bottlingIntegrity';
import { checkPdoEligibility, findPdoCandidates, getPdoRule, PDO_RULES } from '../lib/pdo';
import {
  attachmentUploadPreflightError,
  attachmentsForRecord,
  checksumAttachmentDataUrl,
  formatAttachmentSize,
  getAttachmentAccess,
  SUPPORTED_ATTACHMENT_ACCEPT,
  type DocumentAttachmentInput,
} from '../lib/attachments';
import {
  ActionButton,
  EmptyState,
  FieldLabel,
  InlineNotice,
  MetricCard,
  PageHeader,
  ProgressBar,
  SectionCard,
  StatusBadge,
  cx,
} from './ui/primitives';

interface Props {
  lang: Language;
  lots: WineLot[];
  blocks: VineyardBlock[];
  grapeIntakes: GrapeIntakeRecord[];
  labLogs: LabAnalysis[];
  bottlingRuns: BottlingRunRecord[];
  certificationRecords: CertificationRecord[];
  attachments?: DocumentAttachment[];
  onUpdateCertificationRecords: (records: CertificationRecord[]) => void;
  onUpdateLots: (lots: WineLot[]) => void;
  onAddAttachment?: (attachment: DocumentAttachmentInput) => DocumentAttachment;
  onDeleteAttachment?: (attachmentId: string) => void;
  canManageCertification?: boolean;
  setActiveModule?: (module: any) => void;
  setToastMessage?: (message: string) => void;
}

const PRODUCT_OPTIONS: Array<{ value: CertificationProductType; label: string }> = [
  { value: 'wine', label: 'Wine' },
  { value: 'sparkling_wine', label: 'Sparkling wine' },
  { value: 'chacha_spirit', label: 'Chacha / spirit' },
  { value: 'grape_must_juice', label: 'Grape must / juice' },
  { value: 'fortified_wine', label: 'Fortified wine' },
];

const STATUS_OPTIONS: Array<{ value: CertificationApplicationStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const ORGANOLEPTIC_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'not_required', label: 'Not required' },
] as const;

const BALANCE_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
] as const;

function productTypeForLot(lot?: WineLot): CertificationProductType {
  if (!lot) return 'wine';
  if (lot.wineClass === 'sparkling') return 'sparkling_wine';
  if (lot.wineClass === 'fortified') return 'fortified_wine';
  return 'wine';
}

function makeDraftRecord(lot?: WineLot): CertificationRecord {
  return {
    id: '',
    lotId: lot?.id || '',
    productType: productTypeForLot(lot),
    samplePrepared: false,
    labProtocolUploaded: false,
    organolepticCheckRequired: true,
    organolepticResult: 'pending',
    applicationStatus: 'draft',
    balanceCheckStatus: 'pending',
    purpose: lot?.marketStatus === 'export' ? 'export' : 'local_market',
  };
}

function toLotCertificationStatus(record: CertificationRecord): WineLot['certificationStatus'] {
  if (record.applicationStatus === 'approved') return 'approved';
  if (record.applicationStatus === 'rejected') return 'rejected';
  if (record.applicationStatus === 'submitted') return 'submitted';
  if (record.samplePrepared) return 'sample_prepared';
  return 'not_started';
}

function toMarketStatus(record: CertificationRecord, current?: MarketStatus): MarketStatus {
  if (record.purpose === 'export') return 'export';
  if (record.purpose === 'local_market') return 'local';
  return current || 'unknown';
}

function readinessTone(score: number, criticalCount: number): 'success' | 'warning' | 'danger' | 'info' {
  if (score >= 90 && criticalCount === 0) return 'success';
  if (criticalCount > 0 && score < 50) return 'danger';
  if (criticalCount > 0) return 'warning';
  return 'info';
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '-';
  return String(value);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

export function CertificationManagerTab({
  lang,
  lots,
  blocks,
  grapeIntakes,
  labLogs,
  bottlingRuns,
  certificationRecords,
  attachments = [],
  onUpdateCertificationRecords,
  onUpdateLots,
  onAddAttachment,
  onDeleteAttachment,
  canManageCertification = true,
  setActiveModule,
  setToastMessage,
}: Props) {
  const isKa = lang === 'ka';
  const [selectedLotId, setSelectedLotId] = useState(() => lots[0]?.id || '');
  const [selectedPdoId, setSelectedPdoId] = useState('');
  const selectedLot = useMemo(
    () => lots.find(lot => lot.id === selectedLotId) || lots[0],
    [lots, selectedLotId],
  );
  const existingRecord = useMemo(
    () => selectedLot ? certificationRecords.find(record => record.lotId === selectedLot.id) : undefined,
    [certificationRecords, selectedLot],
  );
  const [form, setForm] = useState<CertificationRecord>(() => makeDraftRecord(selectedLot));

  useEffect(() => {
    if (!selectedLotId && lots[0]) setSelectedLotId(lots[0].id);
  }, [lots, selectedLotId]);

  useEffect(() => {
    setForm(existingRecord ? { ...existingRecord } : makeDraftRecord(selectedLot));
  }, [existingRecord, selectedLot]);

  const linkedIntake = useMemo(() => {
    if (!selectedLot) return undefined;
    return grapeIntakes.find(intake => isActiveHarvestIntake(intake) && intake.createdLotId === selectedLot.id)
      || grapeIntakes.find(intake => isActiveHarvestIntake(intake) && intake.blockName === selectedLot.vineyardBlock);
  }, [grapeIntakes, selectedLot]);

  const linkedBlock = useMemo(() => {
    if (!selectedLot) return undefined;
    if (linkedIntake?.blockId) {
      const byIntake = blocks.find(block => block.id === linkedIntake.blockId);
      if (byIntake) return byIntake;
    }
    return blocks.find(block => (
      block.id === selectedLot.vineyardBlock
      || block.name === selectedLot.vineyardBlock
      || block.parcelName === selectedLot.vineyardBlock
    ));
  }, [blocks, linkedIntake, selectedLot]);

  const pdoCandidates = useMemo(() => {
    if (!selectedLot) return [];
    return findPdoCandidates({ lot: selectedLot, block: linkedBlock, intake: linkedIntake })
      .filter(candidate => candidate.score > 0)
      .slice(0, 5);
  }, [linkedBlock, linkedIntake, selectedLot]);

  useEffect(() => {
    if (!selectedLot) {
      setSelectedPdoId('');
      return;
    }
    const intendedRule = selectedLot.intendedAppellation ? getPdoRule(selectedLot.intendedAppellation) : undefined;
    setSelectedPdoId(intendedRule?.id || pdoCandidates[0]?.pdo.id || PDO_RULES[0]?.id || '');
  }, [pdoCandidates, selectedLot]);

  const pdoResult = useMemo(() => {
    if (!selectedLot || !selectedPdoId) return null;
    try {
      return checkPdoEligibility({
        pdoId: selectedPdoId,
        lot: selectedLot,
        block: linkedBlock,
        intake: linkedIntake,
      });
    } catch {
      return null;
    }
  }, [linkedBlock, linkedIntake, selectedLot, selectedPdoId]);

  const lotLabLogs = useMemo(() => {
    if (!selectedLot) return [];
    return labLogs
      .filter(log => log.lotId === selectedLot.id)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [labLogs, selectedLot]);
  const latestLab = lotLabLogs[0];

  const relatedBottlingRuns = useMemo(() => {
    if (!selectedLot) return [];
    return bottlingRuns
      .filter(run => run.lotId === selectedLot.id && isActiveBottlingRun(run))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [bottlingRuns, selectedLot]);

  const readiness = useMemo(() => {
    if (!selectedLot) return null;
    return evaluateCertificationChecklist({
      productType: form.productType,
      lot: selectedLot,
      latestLab,
      certification: form,
    });
  }, [form, latestLab, selectedLot]);

  const requiredLabFields = useMemo(
    () => requiredLabParameters(form.productType),
    [form.productType],
  );

  const updateForm = <K extends keyof CertificationRecord>(key: K, value: CertificationRecord[K]) => {
    if (!canManageCertification) return;
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const certificationAttachmentRecordId = form.id || existingRecord?.id;
  const linkedCertificationAttachments = useMemo(
    () => certificationAttachmentRecordId
      ? attachmentsForRecord(attachments, 'certificationRecord', certificationAttachmentRecordId)
      : [],
    [attachments, certificationAttachmentRecordId],
  );

  const handleAttachmentUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    kind: 'lab_protocol' | 'certificate_file',
  ) => {
    if (!canManageCertification) {
      event.target.value = '';
      setToastMessage?.('Your role can view certification evidence but cannot upload files.');
      return;
    }
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!onAddAttachment) {
      setToastMessage?.('Attachment storage is not available in this workspace.');
      return;
    }
    const preflightError = attachmentUploadPreflightError(file);
    if (preflightError) {
      setToastMessage?.(preflightError);
      return;
    }

    const recordId = form.id || `cert-${Date.now()}`;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onAddAttachment({
        fileName: file.name,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
        module: 'certification',
        linkedRecordType: 'certificationRecord',
        linkedRecordId: recordId,
        description: kind === 'lab_protocol' ? 'Certification lab protocol' : 'Issued certification file',
        storage: { kind: 'inline', dataUrl },
        checksum: checksumAttachmentDataUrl(dataUrl),
      });
      setForm(prev => ({
        ...prev,
        id: prev.id || recordId,
        labProtocolUploaded: kind === 'lab_protocol' ? true : prev.labProtocolUploaded,
        labProtocolFileName: kind === 'lab_protocol' ? file.name : prev.labProtocolFileName,
        certificateFileName: kind === 'certificate_file' ? file.name : prev.certificateFileName,
      }));
    } catch (error) {
      setToastMessage?.(error instanceof Error && error.message ? error.message : 'Could not read the selected file.');
    }
  };

  const saveRecord = () => {
    if (!selectedLot) return;
    if (!canManageCertification) {
      setToastMessage?.('Your role can view certification records but cannot save changes.');
      return;
    }
    const id = form.id || `cert-${Date.now()}`;
    const record: CertificationRecord = {
      ...form,
      id,
      lotId: selectedLot.id,
      sampleQuantity: form.sampleQuantity === undefined ? undefined : Number(form.sampleQuantity),
    };

    const nextRecords = existingRecord
      ? certificationRecords.map(item => item.id === existingRecord.id ? record : item)
      : [record, ...certificationRecords];
    onUpdateCertificationRecords(nextRecords);

    onUpdateLots(lots.map(lot => {
      if (lot.id !== selectedLot.id) return lot;
      return {
        ...lot,
        certificationStatus: toLotCertificationStatus(record),
        certificateNumber: record.certificateNumber || lot.certificateNumber,
        certificateIssueDate: record.issueDate || lot.certificateIssueDate,
        certificateExpiryDate: record.expiryDate || lot.certificateExpiryDate,
        certificateFileName: record.certificateFileName || lot.certificateFileName,
        marketStatus: toMarketStatus(record, lot.marketStatus),
      };
    }));

    setToastMessage?.(isKa ? 'Certification record saved.' : 'Certification record saved.');
  };

  const applyPdoToLot = () => {
    if (!selectedLot || !pdoResult) return;
    if (!canManageCertification) {
      setToastMessage?.('Your role can review PDO eligibility but cannot update the wine lot.');
      return;
    }
    const originProofStatus: WineLot['originProofStatus'] = pdoResult.eligible ? 'verified' : 'partial';
    onUpdateLots(lots.map(lot => lot.id === selectedLot.id ? {
      ...lot,
      intendedAppellation: pdoResult.pdo.name,
      classification: 'PDO',
      originProofStatus,
      marketStatus: lot.marketStatus || 'unknown',
    } : lot));
    setToastMessage?.(isKa
      ? `PDO check applied: ${pdoResult.pdo.name}`
      : `PDO check applied: ${pdoResult.pdo.name}`);
  };

  if (lots.length === 0) {
    return (
      <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-6">
        <EmptyState
          icon={BadgeCheck}
          title={isKa ? 'No wine lots' : 'No wine lots'}
          description={isKa ? 'Create a wine lot before starting certification.' : 'Create a wine lot before starting certification.'}
          action={
            <ActionButton onClick={() => setActiveModule?.('gvino')} tone="secondary">
              <Wine className="mr-2 h-4 w-4" />
              {isKa ? 'Open cellar' : 'Open cellar'}
            </ActionButton>
          }
        />
      </main>
    );
  }

  const tone = readiness ? readinessTone(readiness.score, readiness.missingCritical.length) : 'info';
  const pdoTone = pdoResult?.eligible ? 'success' : pdoResult ? 'warning' : 'neutral';
  const pdoIssueCount = (pdoResult?.warnings.length || 0) + (pdoResult?.missing.length || 0);
  const editableControlClass = 'w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#4e0e15]/20 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500 disabled:opacity-80 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100 dark:disabled:bg-stone-900 dark:disabled:text-stone-500';

  return (
    <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-6 space-y-5">
      <PageHeader
        eyebrow={isKa ? 'Agency workflow' : 'Agency workflow'}
        title={isKa ? 'Certification Manager' : 'Certification Manager'}
        description={isKa
          ? 'Track sample preparation, lab protocol, organoleptic result, balance check, and issued certificate for each lot.'
          : 'Track sample preparation, lab protocol, organoleptic result, balance check, and issued certificate for each lot.'}
        icon={BadgeCheck}
        actions={canManageCertification ? (
          <ActionButton onClick={saveRecord} disabled={!canManageCertification}>
            <Save className="mr-2 h-4 w-4" />
            {isKa ? 'Save' : 'Save'}
          </ActionButton>
        ) : undefined}
      />

      {!canManageCertification && (
        <InlineNotice tone="neutral">
          <strong className="block text-stone-800 dark:text-stone-100">
            {isKa ? 'სერტიფიკაციის მხოლოდ ნახვის რეჟიმი' : 'Read-only certification access'}
          </strong>
          <span className="mt-0.5 block">
            {isKa
              ? 'შეგიძლიათ ჩანაწერებისა და მტკიცებულებების ნახვა, მაგრამ თქვენი როლი ცვლილებებს ვერ შეიტანს.'
              : 'You can review certification records, eligibility, and evidence, but your role cannot change them.'}
          </span>
        </InlineNotice>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] gap-5">
        <div className="space-y-5 min-w-0">
          <SectionCard
            title={isKa ? 'Lot and certification file' : 'Lot and certification file'}
            subtitle={selectedLot ? `${selectedLot.name} - ${selectedLot.id}` : undefined}
            icon={ClipboardList}
            actions={
              <StatusBadge tone={form.applicationStatus === 'approved' ? 'success' : form.applicationStatus === 'rejected' ? 'danger' : 'info'}>
                {form.applicationStatus}
              </StatusBadge>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <FieldLabel required>{isKa ? 'Wine lot' : 'Wine lot'}</FieldLabel>
                <select aria-label="Wine lot"
                  value={selectedLot?.id || ''}
                  onChange={event => setSelectedLotId(event.target.value)}
                  className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#4e0e15]/20 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100"
                >
                  {lots.filter(lot => !lot.voidedAt).map(lot => (
                    <option key={lot.id} value={lot.id}>
                      {lot.name} ({lot.id})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <FieldLabel required>{isKa ? 'Product type' : 'Product type'}</FieldLabel>
                <select aria-label="Product type"
                  value={form.productType}
                  onChange={event => updateForm('productType', event.target.value as CertificationProductType)}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                >
                  {PRODUCT_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <FieldLabel>{isKa ? 'Application status' : 'Application status'}</FieldLabel>
                <select aria-label="Application status"
                  value={form.applicationStatus}
                  onChange={event => updateForm('applicationStatus', event.target.value as CertificationApplicationStatus)}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                >
                  {STATUS_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <FieldLabel>{isKa ? 'Market purpose' : 'Market purpose'}</FieldLabel>
                <select aria-label="Market purpose"
                  value={form.purpose || 'local_market'}
                  onChange={event => updateForm('purpose', event.target.value as CertificationRecord['purpose'])}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                >
                  <option value="local_market">Local market</option>
                  <option value="export">Export</option>
                </select>
              </label>
            </div>
          </SectionCard>

          <SectionCard
            title={isKa ? 'PDO / Appellation checker' : 'PDO / Appellation checker'}
            subtitle={selectedLot ? `${selectedLot.variety} - ${selectedLot.vintage}` : undefined}
            icon={Compass}
            actions={
              pdoResult ? (
                <StatusBadge tone={pdoTone}>
                  {pdoResult.eligible ? 'eligible' : `${pdoIssueCount} issue${pdoIssueCount === 1 ? '' : 's'}`}
                </StatusBadge>
              ) : undefined
            }
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3 lg:items-end">
                <label className="block">
                  <FieldLabel>{isKa ? 'PDO rule' : 'PDO rule'}</FieldLabel>
                  <select aria-label="PDO rule"
                    value={selectedPdoId}
                    onChange={event => setSelectedPdoId(event.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#4e0e15]/20 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100"
                  >
                    {PDO_RULES.map(rule => (
                      <option key={rule.id} value={rule.id}>
                        {rule.name} - {rule.region}
                      </option>
                    ))}
                  </select>
                </label>
                {canManageCertification && (
                  <ActionButton onClick={applyPdoToLot} disabled={!pdoResult}>
                    <BadgeCheck className="mr-2 h-4 w-4" />
                    {isKa ? 'Apply PDO' : 'Apply PDO'}
                  </ActionButton>
                )}
              </div>

              {pdoCandidates.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pdoCandidates.map(candidate => (
                    <button
                      key={candidate.pdo.id}
                      type="button"
                      onClick={() => setSelectedPdoId(candidate.pdo.id)}
                      className={cx(
                        'rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors',
                        selectedPdoId === candidate.pdo.id
                          ? 'border-[#4e0e15] bg-[#4e0e15] text-amber-50'
                          : 'border-stone-200 bg-stone-50 text-stone-600 hover:border-[#4e0e15]/30 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300',
                      )}
                    >
                      {candidate.pdo.name} · score {candidate.score}
                    </button>
                  ))}
                </div>
              )}

              {!linkedBlock && !linkedIntake && (
                <InlineNotice tone="warning">
                  {isKa
                    ? 'No linked vineyard block or grape intake is available for this lot yet.'
                    : 'No linked vineyard block or grape intake is available for this lot yet.'}
                </InlineNotice>
              )}

              {pdoResult && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    {[
                      ['Lot appellation', selectedLot?.intendedAppellation],
                      ['Block microzone', linkedBlock?.microzone],
                      ['Village', linkedIntake?.village || linkedBlock?.village],
                      ['Cadastral code', linkedIntake?.cadastralCode || linkedBlock?.cadastralCode],
                      ['Grape sugar', linkedIntake?.brix ? `${linkedIntake.brix} Brix` : undefined],
                      ['Grape quantity', linkedIntake?.netWeightKg ? `${linkedIntake.netWeightKg.toLocaleString()} kg` : undefined],
                      ['Block area', linkedBlock?.parcelArea || linkedBlock?.area ? `${linkedBlock?.parcelArea ?? linkedBlock?.area} ha` : undefined],
                      ['Wine yield', linkedIntake?.netWeightKg && selectedLot?.initialVolume ? `${Math.round(selectedLot.initialVolume / (linkedIntake.netWeightKg / 1000))} L/t` : undefined],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-xl border border-stone-200 bg-stone-50/70 p-2 text-[11px] dark:border-stone-800 dark:bg-stone-950/30">
                        <span className="block text-[9px] font-mono font-black uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</span>
                        <strong className="mt-0.5 block text-stone-800 dark:text-stone-100">{value || '-'}</strong>
                      </div>
                    ))}
                  </div>

                  {pdoResult.eligible ? (
                    <InlineNotice tone="success">
                      {isKa
                        ? `${pdoResult.pdo.name} has no missing PDO checklist items for the currently linked evidence.`
                        : `${pdoResult.pdo.name} has no missing PDO checklist items for the currently linked evidence.`}
                    </InlineNotice>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <InlineNotice tone={pdoResult.warnings.length ? 'warning' : 'neutral'}>
                        <strong className="block mb-1">{isKa ? 'Warnings' : 'Warnings'}</strong>
                        {pdoResult.warnings.length ? pdoResult.warnings.join(', ') : 'None'}
                      </InlineNotice>
                      <InlineNotice tone={pdoResult.missing.length ? 'danger' : 'neutral'}>
                        <strong className="block mb-1">{isKa ? 'Missing data' : 'Missing data'}</strong>
                        {pdoResult.missing.length ? pdoResult.missing.join(', ') : 'None'}
                      </InlineNotice>
                    </div>
                  )}

                  <div className="rounded-xl border border-stone-200 bg-white p-3 text-[11px] text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
                    <div className="font-bold text-stone-800 dark:text-amber-100">{pdoResult.pdo.productionMethodNotes}</div>
                    <div className="mt-1">{pdoResult.pdo.labelingNotes}</div>
                    {pdoCandidates.find(candidate => candidate.pdo.id === pdoResult.pdo.id)?.matchedSignals.length ? (
                      <div className="mt-2 text-[10px] font-mono uppercase tracking-wide text-stone-500 dark:text-stone-400">
                        Matched: {pdoCandidates.find(candidate => candidate.pdo.id === pdoResult.pdo.id)?.matchedSignals.join(', ')}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title={isKa ? 'Sample and checks' : 'Sample and checks'} icon={TestTube}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-950/30">
                <span className="flex items-center gap-2 text-xs font-bold text-stone-700 dark:text-stone-200">
                  <input
                    type="checkbox"
                    checked={form.samplePrepared}
                    onChange={event => updateForm('samplePrepared', event.target.checked)}
                    disabled={!canManageCertification}
                    className="h-4 w-4 accent-[#4e0e15] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  {isKa ? 'Sample prepared' : 'Sample prepared'}
                </span>
              </label>

              <label className="block">
                <FieldLabel>{isKa ? 'Sample date' : 'Sample date'}</FieldLabel>
                <DateInput
                  lang={lang}
                  value={form.sampleDate || ''}
                  onValueChange={value => updateForm('sampleDate', value || undefined)}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                />
              </label>

              <label className="block">
                <FieldLabel>{isKa ? 'Sample quantity' : 'Sample quantity'}</FieldLabel>
                <input
                  type="number"
                  min="0"
                  value={form.sampleQuantity ?? ''}
                  onChange={event => updateForm('sampleQuantity', event.target.value === '' ? undefined : Number(event.target.value))}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                  placeholder="2"
                />
              </label>

              <label className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-950/30">
                <span className="flex items-center gap-2 text-xs font-bold text-stone-700 dark:text-stone-200">
                  <input
                    type="checkbox"
                    checked={form.labProtocolUploaded}
                    onChange={event => updateForm('labProtocolUploaded', event.target.checked)}
                    disabled={!canManageCertification}
                    className="h-4 w-4 accent-[#4e0e15] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  {isKa ? 'Lab protocol uploaded' : 'Lab protocol uploaded'}
                </span>
              </label>

              <label className="block md:col-span-2">
                <FieldLabel>{isKa ? 'Lab protocol file' : 'Lab protocol file'}</FieldLabel>
                <input
                  value={form.labProtocolFileName || ''}
                  onChange={event => updateForm('labProtocolFileName', event.target.value || undefined)}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                  placeholder="protocol.pdf"
                />
                {canManageCertification && onAddAttachment && (
                  <span className="mt-2 flex items-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-2 text-[10px] font-bold text-stone-600 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-300">
                    <UploadCloud className="h-3.5 w-3.5 text-[#4e0e15]" />
                    <span className="shrink-0">{isKa ? 'Upload' : 'Upload'}</span>
                    <input
                      type="file"
                      accept={SUPPORTED_ATTACHMENT_ACCEPT}
                      onChange={event => handleAttachmentUpload(event, 'lab_protocol')}
                      className="min-w-0 flex-1 text-[10px]"
                    />
                  </span>
                )}
              </label>

              <label className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-950/30">
                <span className="flex items-center gap-2 text-xs font-bold text-stone-700 dark:text-stone-200">
                  <input
                    type="checkbox"
                    checked={form.organolepticCheckRequired ?? true}
                    onChange={event => updateForm('organolepticCheckRequired', event.target.checked)}
                    disabled={!canManageCertification}
                    className="h-4 w-4 accent-[#4e0e15] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  {isKa ? 'Organoleptic check' : 'Organoleptic check'}
                </span>
              </label>

              <label className="block">
                <FieldLabel>{isKa ? 'Organoleptic result' : 'Organoleptic result'}</FieldLabel>
                <select aria-label="Organoleptic result"
                  value={form.organolepticResult || 'pending'}
                  onChange={event => updateForm('organolepticResult', event.target.value as CertificationRecord['organolepticResult'])}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                >
                  {ORGANOLEPTIC_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <FieldLabel>{isKa ? 'Balance check' : 'Balance check'}</FieldLabel>
                <select aria-label="Balance check"
                  value={form.balanceCheckStatus || 'pending'}
                  onChange={event => updateForm('balanceCheckStatus', event.target.value as CertificationRecord['balanceCheckStatus'])}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                >
                  {BALANCE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </SectionCard>

          <SectionCard title={isKa ? 'Issued certificate' : 'Issued certificate'} icon={FileText}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <FieldLabel>{isKa ? 'Certificate number' : 'Certificate number'}</FieldLabel>
                <input
                  value={form.certificateNumber || ''}
                  onChange={event => updateForm('certificateNumber', event.target.value || undefined)}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                  placeholder="NWA-2026-0001"
                />
              </label>

              <label className="block">
                <FieldLabel>{isKa ? 'Certificate file' : 'Certificate file'}</FieldLabel>
                <input
                  value={form.certificateFileName || ''}
                  onChange={event => updateForm('certificateFileName', event.target.value || undefined)}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                  placeholder="certificate.pdf"
                />
                {canManageCertification && onAddAttachment && (
                  <span className="mt-2 flex items-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-2 text-[10px] font-bold text-stone-600 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-300">
                    <UploadCloud className="h-3.5 w-3.5 text-[#4e0e15]" />
                    <span className="shrink-0">{isKa ? 'Upload' : 'Upload'}</span>
                    <input
                      type="file"
                      accept={SUPPORTED_ATTACHMENT_ACCEPT}
                      onChange={event => handleAttachmentUpload(event, 'certificate_file')}
                      className="min-w-0 flex-1 text-[10px]"
                    />
                  </span>
                )}
              </label>

              <label className="block">
                <FieldLabel>{isKa ? 'Issue date' : 'Issue date'}</FieldLabel>
                <DateInput
                  lang={lang}
                  value={form.issueDate || ''}
                  onValueChange={value => updateForm('issueDate', value || undefined)}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                />
              </label>

              <label className="block">
                <FieldLabel>{isKa ? 'Expiry date' : 'Expiry date'}</FieldLabel>
                <DateInput
                  lang={lang}
                  value={form.expiryDate || ''}
                  onValueChange={value => updateForm('expiryDate', value || undefined)}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                />
              </label>

              <label className="block md:col-span-2">
                <FieldLabel>{isKa ? 'Notes' : 'Notes'}</FieldLabel>
                <textarea
                  value={form.notes || ''}
                  onChange={event => updateForm('notes', event.target.value || undefined)}
                  rows={3}
                  disabled={!canManageCertification}
                  className={editableControlClass}
                />
              </label>
            </div>
          </SectionCard>
        </div>

        <aside className="space-y-5 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
            <MetricCard
              label={isKa ? 'Readiness' : 'Readiness'}
              value={readiness ? `${readiness.score}%` : '-'}
              detail={readiness?.badge || 'No lot selected'}
              icon={BadgeCheck}
              tone={tone}
            />
            <MetricCard
              label={isKa ? 'Latest lab' : 'Latest lab'}
              value={latestLab?.date || '-'}
              detail={latestLab?.protocolNumber || latestLab?.protocolFileName || 'No linked protocol'}
              icon={TestTube}
              tone={latestLab ? 'success' : 'warning'}
            />
          </div>

          {readiness && (
            <SectionCard title={isKa ? 'Checklist' : 'Checklist'} icon={CheckCircle2}>
              <ProgressBar value={readiness.score} tone={tone} label={readiness.badge} />
              <div className="mt-4 space-y-2">
                {readiness.requirements.map(req => (
                  <div
                    key={req.id}
                    className={cx(
                      'flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold',
                      req.met
                        ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200'
                        : req.critical
                          ? 'border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-200'
                          : 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200',
                    )}
                  >
                    {req.met ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                    <span>{req.labelEn}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          <SectionCard title={isKa ? 'Linked evidence' : 'Linked evidence'} icon={Package}>
            <div className="space-y-3">
              <div>
                <h4 className="text-[10px] font-black uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  {isKa ? 'Required lab parameters' : 'Required lab parameters'}
                </h4>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {requiredLabFields.map(field => (
                    <div key={String(field)} className="rounded-xl border border-stone-200 bg-stone-50 p-2 text-[11px] dark:border-stone-800 dark:bg-stone-950/30">
                      <span className="block font-bold text-stone-700 dark:text-stone-200">{String(field)}</span>
                      <span className="text-stone-500 dark:text-stone-400">{formatValue(latestLab?.[field])}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-[10px] font-black uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  {isKa ? 'Bottling run' : 'Bottling run'}
                </h4>
                <select aria-label="Bottling run"
                  value={form.bottlingRunId || ''}
                  onChange={event => updateForm('bottlingRunId', event.target.value || undefined)}
                  disabled={!canManageCertification}
                  className={cx('mt-2', editableControlClass)}
                >
                  <option value="">{isKa ? 'ჩამოსხმის პარტია არ არის მიბმული' : 'No bottling run linked'}</option>
                  {relatedBottlingRuns.map(run => (
                    <option key={run.id} value={run.id}>
                      {run.date} - {run.totalBottles + run.totalCeramic} bottles ({run.id})
                    </option>
                  ))}
                </select>
              </div>

              {relatedBottlingRuns.length === 0 && (
                <InlineNotice tone="warning">
                  {isKa ? 'No bottling act is linked to this lot yet.' : 'No bottling act is linked to this lot yet.'}
                </InlineNotice>
              )}

              {selectedLot && (
                <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 text-[11px] font-semibold text-stone-600 dark:border-stone-800 dark:bg-stone-950/30 dark:text-stone-300">
                  <div className="flex justify-between gap-3"><span>Class</span><strong>{selectedLot.wineClass}</strong></div>
                  <div className="mt-1 flex justify-between gap-3"><span>Classification</span><strong>{selectedLot.classification || '-'}</strong></div>
                  <div className="mt-1 flex justify-between gap-3"><span>Appellation</span><strong>{selectedLot.intendedAppellation || '-'}</strong></div>
                  <div className="mt-1 flex justify-between gap-3"><span>Lot status</span><strong>{selectedLot.certificationStatus || 'not_started'}</strong></div>
                </div>
              )}

              {linkedCertificationAttachments.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-wide text-stone-500 dark:text-stone-400">
                    {isKa ? 'Uploaded files' : 'Uploaded files'}
                  </h4>
                  <div className="mt-2 space-y-2">
                    {linkedCertificationAttachments.map(attachment => {
                      const access = getAttachmentAccess(attachment);
                      return (
                        <div key={attachment.id} className="flex items-start gap-2 rounded-xl border border-stone-200 bg-white p-2 text-[11px] dark:border-stone-800 dark:bg-stone-950">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-bold text-stone-800 dark:text-stone-100">{attachment.fileName}</div>
                            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
                              {formatAttachmentSize(attachment.sizeBytes)} - {attachment.description || attachment.module}
                              {attachment.checksum ? ` - sha256:${attachment.checksum.slice(0, 12)}` : ''}
                            </div>
                          </div>
                          {access && (
                            <a
                              href={access.href}
                              download={access.download}
                              target={access.external ? '_blank' : undefined}
                              rel={access.external ? 'noreferrer' : undefined}
                              className="rounded-lg border border-stone-200 bg-white p-1 text-stone-500 transition-colors hover:border-emerald-200 hover:text-emerald-700 dark:border-stone-800 dark:bg-stone-900"
                              title={access.label}
                              aria-label={`${access.label} ${attachment.fileName}`}
                            >
                              {access.external ? <ExternalLink className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                            </a>
                          )}
                          {canManageCertification && onDeleteAttachment && (
                            <button
                              type="button"
                              onClick={() => onDeleteAttachment(attachment.id)}
                              className="rounded-lg border border-stone-200 bg-white p-1 text-stone-500 transition-colors hover:border-rose-200 hover:text-rose-700 dark:border-stone-800 dark:bg-stone-900"
                              title={isKa ? 'Remove evidence' : 'Remove evidence'}
                              aria-label={isKa ? 'Remove evidence' : 'Remove evidence'}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        </aside>
      </div>
    </main>
  );
}

/**
 * Memoized: `useWineryState` hands out stable handler identities, so a state
 * change elsewhere in the app (a toast, a sync timestamp, another module's
 * records) leaves this component’s props referentially equal and React skips
 * the re-render entirely.
 */
export default React.memo(CertificationManagerTab);
