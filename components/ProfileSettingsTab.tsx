import React from 'react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import type { UserProfile, CompanyProfile, CrmLeadRecord } from '../lib/wineryState';
import { GEORGIAN_WINE_REGIONS } from '../lib/georgianWineKnowledge';
import { crmLeadContactLine } from '../lib/crm';
import { localizedRoleLabel } from '../lib/roleLabels';
import { canViewAppDestination } from '../lib/navigationPermissions';
import {
  directoryRecordToCrmLead,
  directoryRecordLabel,
  importWineryDirectoryRecord,
  parseWineryDirectoryText,
  type WineryCrmLead,
  type WineryDirectoryRecord
} from '../lib/wineryDirectoryImport';

interface ProfileSettingsTabProps {
  lang: Language;
  currentUser: UserProfile;
  setCurrentUser: (val: UserProfile) => void;
  companyProfile: CompanyProfile;
  setCompanyProfile: (val: CompanyProfile) => void;
  setToastMessage: (val: string | null) => void;
  onClearAllData?: () => void;
  onUpdateProfile?: (updates: Partial<UserProfile>) => Promise<void>;
  crmLeads?: CrmLeadRecord[];
  onSaveCrmLead?: (lead: WineryCrmLead) => void;
  onUpdateCrmLeadStatus?: (leadId: string, status: CrmLeadRecord['status']) => void;
  onDeleteCrmLead?: (leadId: string) => void;
  canManageProfile?: boolean;
  canManageCrm?: boolean;
  organizations?: { id: string; name: string; role: string; isActive: boolean }[];
  onSwitchOrganization?: (orgId: string) => Promise<boolean>;
  manualLowPower: boolean;
  onToggleLowPower: () => void;
}

export function profileWorkspaceFormKey(
  activeOrganizationId: string | undefined,
  version: number,
  companyName = '',
  wineryName = '',
): string {
  return `${activeOrganizationId || 'workspace'}-${version}-${companyName}-${wineryName}`;
}

export default function ProfileSettingsTab({
  lang,
  currentUser,
  setCurrentUser,
  companyProfile,
  setCompanyProfile,
  setToastMessage,
  onClearAllData,
  onUpdateProfile,
  crmLeads = [],
  onSaveCrmLead,
  onUpdateCrmLeadStatus,
  onDeleteCrmLead,
  canManageProfile = true,
  canManageCrm = true,
  organizations,
  onSwitchOrganization,
  manualLowPower,
  onToggleLowPower
}: ProfileSettingsTabProps) {
  const t = translations[lang];
  const effectiveRoleLabelId = React.useId();

  const [members, setMembers] = React.useState<{ username: string; fullName: string; email: string; role: string }[]>([]);
  const [pendingInvites, setPendingInvites] = React.useState<{ id: string; email: string; role: string; expiresAt: string }[]>([]);
  const [loadingMembers, setLoadingMembers] = React.useState(false);
  const [invitingEmail, setInvitingEmail] = React.useState('');
  const [invitingRole, setInvitingRole] = React.useState('Winemaker');
  const [inviteResult, setInviteResult] = React.useState<string | null>(null);
  const [profileFormVersion, setProfileFormVersion] = React.useState(0);
  const [directoryText, setDirectoryText] = React.useState('');
  const [directoryRecords, setDirectoryRecords] = React.useState<WineryDirectoryRecord[]>([]);
  const [selectedDirectoryId, setSelectedDirectoryId] = React.useState('');
  const [directoryMessage, setDirectoryMessage] = React.useState<string | null>(null);

  const activeOrg = organizations?.find(o => o.isActive);
  const effectiveRole = activeOrg?.role || currentUser.role;
  const isOwnerAdmin = effectiveRole === 'Owner/Admin';
  const canUseVineyard = canViewAppDestination(effectiveRole, 'vazi');
  const canUseCellar = canViewAppDestination(effectiveRole, 'gvino');
  const selectedDirectoryRecord = directoryRecords.find(record => record.directoryId === selectedDirectoryId) || directoryRecords[0] || null;
  const selectedLead = selectedDirectoryRecord ? directoryRecordToCrmLead(selectedDirectoryRecord, 'manual_directory_import') : null;
  const savedLeadIds = new Set(crmLeads.map(lead => lead.id));

  const fetchMembers = async () => {
    if (!currentUser) return;
    setLoadingMembers(true);
    try {
      const res = await fetch('/api/org/members');
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
        setPendingInvites(data.pendingInvites || []);
      }
    } catch (err) {
      console.error('Failed to fetch team members:', err);
    } finally {
      setLoadingMembers(false);
    }
  };

  React.useEffect(() => {
    fetchMembers();
  }, [activeOrg?.id]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitingEmail) return;
    setInviteResult(null);
    try {
      const res = await fetch('/api/org/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: invitingEmail, role: invitingRole })
      });
      if (res.ok) {
        const data = await res.json();
        setInvitingEmail('');
        setToastMessage(lang === 'ka' ? 'მოწვევა წარმატებით გაიგზავნა!' : 'Invitation sent successfully!');
        if (data.devInviteUrl) {
          setInviteResult(lang === 'ka' ? `დეველოპმენტის ბმული: ${data.devInviteUrl}` : `Development Invite Link: ${data.devInviteUrl}`);
        }
        fetchMembers();
      } else {
        const err = await res.json();
        setToastMessage(`⚠️ ${err.error || 'Failed to send invitation'}`);
      }
    } catch (err) {
      setToastMessage(lang === 'ka' ? '⚠️ კავშირის შეცდომა მოწვევისას.' : '⚠️ Connection error while sending invitation.');
    }
  };

  const handleParseDirectory = () => {
    const parsed = parseWineryDirectoryText(directoryText);
    setDirectoryRecords(parsed.records);
    setSelectedDirectoryId(parsed.records[0]?.directoryId || '');
    setDirectoryMessage(parsed.records.length > 0
      ? `${parsed.records.length} directory record(s) ready. ${parsed.warnings.join(' ')}`
      : parsed.warnings.join(' '));
  };

  const handleApplyDirectory = () => {
    if (!canManageProfile) {
      setDirectoryMessage('Your role can view directory data but cannot update the company profile.');
      return;
    }
    const selected = selectedDirectoryRecord;
    if (!selected) {
      setDirectoryMessage('Parse a directory row before applying it.');
      return;
    }
    const imported = importWineryDirectoryRecord(selected, companyProfile);
    setCompanyProfile(imported.profile);
    setProfileFormVersion(version => version + 1);
    const warningText = imported.warnings.length > 0 ? ` ${imported.warnings.join(' ')}` : '';
    setDirectoryMessage(`Imported ${imported.changes.length} profile field(s).${warningText}`);
    setToastMessage(lang === 'ka' ? 'Directory profile imported.' : 'Directory profile imported.');
  };

  const handleSaveLead = () => {
    if (!selectedLead || !onSaveCrmLead) return;
    onSaveCrmLead(selectedLead);
    setDirectoryMessage(`Saved CRM lead: ${selectedLead.displayName}`);
  };


  return (
    <main className="flex-1 max-w-4xl w-full mx-auto p-4 lg:p-6 flex flex-col space-y-6 font-sans text-stone-700 text-xs animate-fade-in">
      <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm space-y-6">
        <div>
          <h3 className="text-md font-serif font-black text-[#4e0e15] border-b border-stone-100 pb-2 uppercase tracking-wide">
            🏠 {t.settings_title || 'Company & User Profile Preferences'}
          </h3>
          <p className="text-[10px] text-slate-450 mt-1">
            {lang === 'ka' ? 'კომპანიის პარამეტრების, ლოკალიზაციისა და როლების მართვა' : 'Configure company profiles, localization formats and operational user permissions'}
          </p>
        </div>

        <form
          key={profileWorkspaceFormKey(
            activeOrg?.id,
            profileFormVersion,
            companyProfile.companyName,
            companyProfile.wineryName,
          )}
          onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          if (canManageProfile) {
            setCompanyProfile({
              ...companyProfile,
              companyName: fd.get('companyName') as string,
              wineryName: fd.get('wineryName') as string,
              country: fd.get('country') as string,
              region: fd.get('region') as string,
              municipality: fd.get('municipality') as string,
              address: fd.get('address') as string,
              identificationCode: fd.get('identificationCode') as string,
              wineAgencyRegistrationCode: fd.get('wineAgencyRegistrationCode') as string,
              legalAddress: (fd.get('legalAddress') as string) || (fd.get('address') as string),
              factualAddress: (fd.get('factualAddress') as string) || (fd.get('address') as string),
              certificateContactPerson: fd.get('certificateContactPerson') as string,
              certificatePhone: fd.get('certificatePhone') as string,
              certificateEmail: fd.get('certificateEmail') as string,
              producerRegistrationNotes: fd.get('producerRegistrationNotes') as string,
              contactEmail: fd.get('contactEmail') as string,
              phone: fd.get('phone') as string,
              website: fd.get('website') as string,
              measurementUnits: fd.get('units') as any,
              currency: (fd.get('currency') as string) || 'GEL',
              latitude: parseFloat(fd.get('latitude') as string) || 41.9056,
              longitude: parseFloat(fd.get('longitude') as string) || 45.4740
            });
          }
          
          const modules = fd.getAll('enabledModules') as string[];
          const widgets = fd.getAll('enabledWidgets') as string[];
          
          if (modules.length === 0) {
            alert(lang === 'ka' ? 'გთხოვთ აირჩიოთ მინიმუმ ერთი აქტიური მოდული.' : 'Please enable at least one active module.');
            return;
          }
          
          if (onUpdateProfile) {
            await onUpdateProfile({
              fullName: currentUser.fullName,
              enabledModules: modules,
              enabledWidgets: widgets
            });
          }
          
          setToastMessage(lang === 'ka' ? 'პარამეტრები წარმატებით შეინახა!' : 'Preferences saved successfully!');
          }}
          className="space-y-4"
        >
          <datalist id="georgian-region-options">
            {GEORGIAN_WINE_REGIONS.map(region => (
              <option key={region.id} value={region.name} />
            ))}
          </datalist>

          <div className="bg-stone-50/70 border border-[#e8dfd5] p-4 rounded-xl space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-[9px] uppercase font-mono border-l-2 border-[#c5a059] pl-2 font-black tracking-wider text-slate-500">
                Winery Directory Import
              </h4>
              <span className="text-[9px] font-mono text-stone-400">{directoryRecords.length} parsed</span>
            </div>
            <textarea
              value={directoryText}
              onChange={(e) => setDirectoryText(e.target.value)}
              rows={3}
              placeholder="Company,Winery,Identification Code,Wine Agency Code,Region,Municipality,Address,Email,Phone"
              className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-[10.5px] font-mono outline-none resize-y"
            />
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-center">
              <select
                value={selectedDirectoryId}
                onChange={(e) => setSelectedDirectoryId(e.target.value)}
                className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-[10.5px] font-semibold outline-none"
              >
                <option value="">No parsed record selected</option>
                {directoryRecords.map(record => (
                  <option key={record.directoryId} value={record.directoryId}>
                    {directoryRecordLabel(record)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleParseDirectory}
                className="px-3 py-2 border border-[#d8c6b4] bg-white hover:bg-stone-100 text-[#4e0e15] text-[10px] font-mono font-bold rounded cursor-pointer"
              >
                Parse
              </button>
              <button
                type="button"
                onClick={handleApplyDirectory}
                disabled={directoryRecords.length === 0 || !canManageProfile}
                className="px-3 py-2 bg-[#4e0e15] hover:bg-[#801323] text-white text-[10px] font-mono font-bold rounded cursor-pointer disabled:opacity-50"
              >
                Apply
              </button>
            </div>
            {directoryMessage && (
              <p className="text-[10px] font-mono text-stone-500 leading-relaxed">
                {directoryMessage}
              </p>
            )}
            {selectedLead && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-[10.5px] leading-relaxed text-emerald-950">
                <div className="font-mono text-[9px] font-black uppercase tracking-wider text-emerald-800">
                  CRM Lead Preview
                </div>
                <div className="mt-1 font-bold">{selectedLead.displayName}</div>
                <div className="mt-1 text-emerald-900/80">
                  {[selectedLead.contactEmail, selectedLead.phone, selectedLead.website].filter(Boolean).join(' · ') || 'No contact details in row'}
                </div>
                <div className="mt-1 font-mono text-[9px] text-emerald-800">
                  {selectedLead.tags.join(', ')}
                </div>
                <button
                  type="button"
                  onClick={handleSaveLead}
                  disabled={!onSaveCrmLead || !canManageCrm || savedLeadIds.has(selectedLead.id)}
                  className="mt-2 px-2.5 py-1 rounded bg-emerald-800 text-white text-[9px] font-mono font-black uppercase disabled:opacity-50"
                >
                  {savedLeadIds.has(selectedLead.id) ? 'Saved lead' : 'Save lead'}
                </button>
              </div>
            )}
            {crmLeads.length > 0 && (
              <div className="rounded-lg border border-[#e8dfd5] bg-white p-3">
                <div className="text-[9px] font-mono font-black uppercase tracking-wider text-stone-500">
                  Saved CRM Leads
                </div>
                <div className="mt-2 space-y-2">
                  {crmLeads.slice(0, 4).map(lead => (
                    <div key={lead.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-[10.5px]">
                      <div className="min-w-0">
                        <div className="truncate font-bold text-stone-800">{lead.displayName}</div>
                        <div className="truncate text-stone-500">{crmLeadContactLine(lead)}</div>
                      </div>
                      <select
                        value={lead.status}
                        disabled={!canManageCrm || !onUpdateCrmLeadStatus}
                        onChange={event => onUpdateCrmLeadStatus?.(lead.id, event.target.value as CrmLeadRecord['status'])}
                        className="rounded-full border border-stone-200 bg-stone-50 px-2 py-1 text-[8.5px] font-mono font-black uppercase text-stone-600 disabled:opacity-50"
                      >
                        {['new', 'contacted', 'qualified', 'customer', 'archived'].map(status => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!canManageCrm || !onDeleteCrmLead}
                        onClick={() => onDeleteCrmLead?.(lead.id)}
                        className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[8.5px] font-mono font-black uppercase text-rose-700 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {!canManageProfile && (
            <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10.5px] font-semibold leading-relaxed text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
              {lang === 'ka'
                ? 'კომპანიის ოფიციალური მონაცემები მხოლოდ სანახავია. თქვენი პირადი პროფილი, მოდულები და ვიჯეტები ქვემოთ კვლავ შეგიძლიათ შეცვალოთ.'
                : 'Company information is read-only for your role. You can still update your personal profile, modules, and dashboard widgets below.'}
            </div>
          )}

          <fieldset disabled={!canManageProfile} className="space-y-4 disabled:opacity-70">
          <legend className="text-[9px] uppercase font-mono border-l-2 border-[#4e0e15] pl-2 font-black tracking-wider text-slate-400">
            {lang === 'ka' ? 'საწარმოს ოფიციალური რეკვიზიტები' : 'Agricultural Corporate Enterprise Specifications'}
          </legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{t.settings_co_name || 'Company Operating Name'}</label>
              <input type="text" name="companyName" defaultValue={companyProfile.companyName} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded text-stone-800 font-bold outline-none" required />
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{t.settings_winery_name || 'Headquarters Winery Name'}</label>
              <input type="text" name="wineryName" defaultValue={companyProfile.wineryName} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded text-stone-800 font-bold outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'საიდენტიფიკაციო კოდი' : 'Company identification code'}</label>
              <input type="text" name="identificationCode" defaultValue={companyProfile.identificationCode || ''} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-semibold" />
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'ღვინის სააგენტოს რეგ. კოდი' : 'Wine Agency registration code'}</label>
              <input type="text" name="wineAgencyRegistrationCode" defaultValue={companyProfile.wineAgencyRegistrationCode || ''} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-semibold" />
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'იურიდიული მისამართი' : 'Legal address'}</label>
              <input type="text" name="legalAddress" defaultValue={companyProfile.legalAddress || companyProfile.address || ''} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-semibold" />
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'ფაქტობრივი მისამართი' : 'Factual address'}</label>
              <input type="text" name="factualAddress" defaultValue={companyProfile.factualAddress || companyProfile.address || ''} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-semibold" />
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'სერტიფიკატის საკონტაქტო პირი' : 'Certificate contact person'}</label>
              <input type="text" name="certificateContactPerson" defaultValue={companyProfile.certificateContactPerson || ''} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-semibold" />
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'სერტიფიკატის ტელ./ელფოსტა' : 'Certificate phone / email'}</label>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" name="certificatePhone" defaultValue={companyProfile.certificatePhone || companyProfile.phone || ''} placeholder={lang === 'ka' ? 'ტელეფონი' : 'Phone'} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-semibold" />
                <input type="email" name="certificateEmail" defaultValue={companyProfile.certificateEmail || companyProfile.contactEmail || ''} placeholder={lang === 'ka' ? 'ელფოსტა' : 'Email'} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-semibold" />
              </div>
            </div>
          </div>

          <div>
            <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'მწარმოებლის / რეგისტრაციის შენიშვნები' : 'Producer / registration notes'}</label>
            <input type="text" name="producerRegistrationNotes" defaultValue={companyProfile.producerRegistrationNotes || ''} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-semibold" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{t.settings_country || 'Country'}</label>
              <input type="text" name="country" defaultValue={companyProfile.country} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none" />
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{t.settings_region || 'PDO Region'}</label>
              <input type="text" name="region" defaultValue={companyProfile.region} list="georgian-region-options" className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none" />
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{t.settings_district || 'District'}</label>
              <input type="text" name="municipality" defaultValue={companyProfile.municipality} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-bold">{t.settings_email || 'Contact Email'}</label>
              <input type="email" name="contactEmail" defaultValue={companyProfile.contactEmail} className="w-full bg-stone-50 border border-[#e8dfd5] p-2 rounded outline-none" />
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-bold">{t.settings_phone || 'Hotline Phone'}</label>
              <input type="text" name="phone" defaultValue={companyProfile.phone} className="w-full bg-stone-50 border border-[#e8dfd5] p-2 rounded outline-none" />
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-bold">{t.settings_units || 'Standard Measurement Units'}</label>
              <select name="units" defaultValue={companyProfile.measurementUnits} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-bold text-stone-900">
                <option value="metric">{t.settings_unit_metric || 'Metric (L, kg, °C, ha)'}</option>
                <option value="imperial">{t.settings_unit_us || 'US Customary (gal, lb, °F, acre)'}</option>
              </select>
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'ვალუტა (ხარჯები)' : 'Currency (costing)'}</label>
              <select name="currency" defaultValue={companyProfile.currency || 'GEL'} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-bold text-stone-900">
                <option value="GEL">GEL — ₾ {lang === 'ka' ? 'ლარი' : 'Georgian Lari'}</option>
                <option value="EUR">EUR — € Euro</option>
                <option value="USD">USD — $ US Dollar</option>
                <option value="GBP">GBP — £ Pound</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'ფიზიკური მისამართი' : 'Company Physical Street Address'}</label>
            <input type="text" name="address" defaultValue={companyProfile.address} className="w-full bg-stone-50 border border-[#e8dfd5] p-2 rounded outline-none font-semibold text-stone-850" />
          </div>

          {/* Precise Coordinates override because GPS in browsers can be imprecise */}
          <div className="bg-amber-50/70 border border-amber-200 p-4 rounded-xl space-y-2">
            <span className="text-[9px] font-mono uppercase bg-amber-200 text-amber-955 px-2.5 py-1 rounded font-black tracking-wider inline-block">
              {lang === 'ka' ? 'სათავო ოფისის GPS კოორდინატები' : 'Precise Manual Coordinates Control'}
            </span>
            <p className="text-[10px] leading-relaxed text-stone-600">
              {lang === 'ka' 
                ? 'ვებ ბრაუზერებში GPS სიზუსტე შეიძლება არასანდო იყოს. გთხოვთ ხელით მიუთითოთ ზუსტი კოორდინატები სატელიტური ამინდისა და დაავადებების რისკების სწორი მოდელირებისთვის.' 
                : 'System GPS location can be inaccurate inside web sandboxes. Explicitly defining manual coordinates enables highly granular satellite weather analysis and precise mildew risk indexing.'}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">Manual Latitude</label>
                <input 
                  type="number" 
                  step="0.0001" 
                  name="latitude" 
                  defaultValue={companyProfile.latitude ?? 41.9056} 
                  className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-800 font-mono outline-none focus:border-amber-500" 
                />
              </div>
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">Manual Longitude</label>
                <input 
                  type="number" 
                  step="0.0001" 
                  name="longitude" 
                  defaultValue={companyProfile.longitude ?? 45.4740} 
                  className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-800 font-mono outline-none focus:border-amber-500" 
                />
              </div>
            </div>
          </div>
          </fieldset>

          <hr className="border-stone-100" />

          <h4 className="text-[9px] uppercase font-mono border-l-2 border-emerald-800 pl-2 font-black tracking-wider text-slate-400">
            {lang === 'ka' ? 'ოპერატორის პროფილი და მოქმედი წვდომა' : 'Operator Profile and Effective Access'}
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="operator-full-name" className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'ოპერატორის სრული სახელი' : 'Operator Full Name'}</label>
              <input 
                id="operator-full-name"
                type="text" 
                value={currentUser.fullName}
                onChange={(e) => setCurrentUser({ ...currentUser, fullName: e.target.value })}
                className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded text-stone-900 font-bold outline-none" 
              />
            </div>
            <div>
              <p id={effectiveRoleLabelId} className="text-[9px] uppercase font-mono block mb-1 font-bold text-[#4e0e15]">
                {lang === 'ka' ? 'მოქმედი როლი' : 'Effective workspace role'}
              </p>
              <div
                className="min-h-[42px] rounded border border-[#e8dfd5] bg-stone-50 p-2.5"
                aria-labelledby={effectiveRoleLabelId}
                aria-live="polite"
              >
                <span className="block font-extrabold text-[#4e0e15] dark:text-amber-200">
                  {localizedRoleLabel(effectiveRole, lang)}
                </span>
                <span className="mt-1 block text-[9.5px] font-medium leading-relaxed text-stone-500 dark:text-stone-400">
                  {lang === 'ka'
                    ? 'ეს როლი განისაზღვრება აქტიურ სამუშაო სივრცეში თქვენი წევრობით და აქ ვერ შეიცვლება. როლებს სამუშაო სივრცის მფლობელები მართავენ.'
                    : 'This role comes from your active workspace membership and cannot be changed here. Workspace owners manage role assignments.'}
                </span>
              </div>
            </div>
          </div>

          <hr className="border-stone-100" />

          <h4 className="text-[9px] uppercase font-mono border-l-2 border-[#801323] pl-2 font-black tracking-wider text-slate-400">
            {lang === 'ka' ? 'პლატფორმის აქტიური მოდულები' : 'Workspace Active Modules Selection'}
          </h4>

          <div className="grid grid-cols-2 gap-4">
            {canUseVineyard && (
            <label className="flex items-start gap-2.5 p-3.5 bg-stone-50 border border-stone-200 rounded-xl cursor-pointer hover:border-emerald-500/50 transition-all select-none">
              <input 
                type="checkbox" 
                name="enabledModules" 
                value="vazi" 
                defaultChecked={(currentUser.enabledModules || ['vazi', 'gvino']).includes('vazi')}
                className="h-4.5 w-4.5 rounded border-stone-300 text-emerald-800 focus:ring-emerald-800 accent-emerald-800 cursor-pointer mt-0.5"
              />
              <div>
                <span className="font-bold block text-stone-900">🚜 {lang === 'ka' ? 'მევენახეობა (ვაზი)' : 'Viticulture (Vazi / Vineyard)'}</span>
                <span className="block text-[10px] text-slate-450 mt-0.5 leading-relaxed">
                  {lang === 'ka' ? 'ვენახის ნაკვეთების, GDD ჯამებისა და ჭრაქის რისკების კონტროლი' : 'Track blocks, spray schedules, GDD heat summation, and downy mildew risk forecasts.'}
                </span>
              </div>
            </label>
            )}

            {canUseCellar && (
            <label className="flex items-start gap-2.5 p-3.5 bg-stone-50 border border-stone-200 rounded-xl cursor-pointer hover:border-[#801323]/50 transition-all select-none">
              <input 
                type="checkbox" 
                name="enabledModules" 
                value="gvino" 
                defaultChecked={(currentUser.enabledModules || ['vazi', 'gvino']).includes('gvino')}
                className="h-4.5 w-4.5 rounded border-stone-300 text-[#4e0e15] focus:ring-[#4e0e15] accent-[#4e0e15] cursor-pointer mt-0.5"
              />
              <div>
                <span className="font-bold block text-stone-900">🍷 {lang === 'ka' ? 'მეღვინეობა (ღვინო)' : 'Winery (Gvino / Cellar)'}</span>
                <span className="block text-[10px] text-slate-450 mt-0.5 leading-relaxed">
                  {lang === 'ka' ? 'მარნის ჭურჭლის, ლაბორატორიისა და დუღილის ანალიზის მოდული' : 'Manage vessels, clay qvevris, wine lots, laboratory metrics, SO2 buffers, and the AI winemaker assistant.'}
                </span>
              </div>
            </label>
            )}
          </div>

          <hr className="border-stone-100" />

          <h4 className="text-[9px] uppercase font-mono border-l-2 border-amber-600 pl-2 font-black tracking-wider text-slate-400">
            {lang === 'ka' ? 'მთავარი გვერდის პორტალის ვიჯეტები' : 'Dashboard Portal Widgets Customization'}
          </h4>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { id: 'chemistry', module: 'gvino', tab: 'labs', label: lang === 'ka' ? '⚠️ უსაფრთხოება და ქიმია' : '⚠️ Safety & Chemistry Alerts' },
              { id: 'weather', module: 'vazi', label: lang === 'ka' ? '🌦️ მეტეო და ჭრაქის რისკი' : '🌦️ Weather Station & Mildew Forecasts' },
              { id: 'fermentation', module: 'gvino', tab: 'fermentation', label: lang === 'ka' ? '🔥 დუღილის ტელემეტრია' : '🔥 Active Fermentations & Telemetry' },
              { id: 'canopy', module: 'vazi', label: lang === 'ka' ? '🌿 ვენახის ფოთლის რადარი' : '🌿 Vineyard Canopy Status Radar' },
              { id: 'tasks', module: 'gvino', tab: 'tasks', label: lang === 'ka' ? '📋 დავალებების ჩეკლისტი' : '📋 Unified Operations Tasklist' },
              { id: 'audit', module: 'audit', label: lang === 'ka' ? '🛡️ აუდიტის ჟურნალი' : '🛡️ Immutable Audit Trail Ledger' }
            ].filter(widget => canViewAppDestination(effectiveRole, widget.module, widget.tab)).map(widget => (
              <label key={widget.id} className="flex items-center gap-2 p-3 bg-stone-50 border border-stone-150 rounded-xl hover:bg-stone-100/50 cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  name="enabledWidgets" 
                  value={widget.id} 
                  defaultChecked={(currentUser.enabledWidgets || ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks', 'audit']).includes(widget.id)}
                  className="h-4 w-4 rounded text-amber-600 focus:ring-amber-500 accent-amber-600 cursor-pointer"
                />
                <span className="font-bold text-stone-800 block text-[10.5px] leading-tight">{widget.label}</span>
              </label>
            ))}
          </div>

          <hr className="border-stone-100" />

          <h4 className="text-[9px] uppercase font-mono border-l-2 border-stone-500 pl-2 font-black tracking-wider text-slate-400">
            {lang === 'ka' ? 'ინტერფეისის წარმადობა' : 'UI Performance Preferences'}
          </h4>

          <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="font-bold text-stone-900 dark:text-amber-100 block text-[10.5px]">
                ⚡ {lang === 'ka' ? 'ენერგიის დამზოგი რეჟიმი' : 'Low Power UI Mode'}
              </span>
              <span className="block text-[9.5px] text-slate-400 dark:text-stone-550 leading-normal">
                {lang === 'ka' 
                  ? 'თიშავს ფონურ ანიმაციებს და ეფექტებს ბატარეისა და პროცესორის რესურსების დასაზოგად.' 
                  : 'Stops ambient drifting backdrops and complex visual effects to optimize CPU/GPU battery runtimes.'}
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={manualLowPower} 
                onChange={onToggleLowPower}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          <hr className="border-stone-100" />

          <button 
            type="submit"
            disabled={!canManageProfile && !onUpdateProfile}
            className="w-full bg-emerald-850 hover:bg-emerald-950 text-white font-mono font-bold uppercase py-2.5 rounded-lg text-xs cursor-pointer shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {canManageProfile
              ? (t.settings_save || 'Save Configurations')
              : (lang === 'ka' ? 'პირადი პარამეტრების შენახვა' : 'Save Personal Preferences')}
          </button>
        </form>
      </div>

      {/* 🏢 Organization & Team Management */}
      <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm space-y-6">
        <div>
          <h3 className="text-md font-serif font-black text-[#4e0e15] border-b border-stone-100 pb-2 uppercase tracking-wide">
            🏢 {lang === 'ka' ? 'ორგანიზაცია და გუნდის მართვა' : 'Organization & Team Management'}
          </h3>
          <p className="text-[10px] text-slate-450 mt-1">
            {lang === 'ka' ? 'მართეთ თქვენი სამუშაო სივრცეები და მოიწვიეთ გუნდის წევრები.' : 'Switch between winery workspaces and manage your enology and viticulture team.'}
          </p>
        </div>

        {/* Workspace Switcher */}
        {organizations && organizations.length > 0 && (
          <div className="space-y-3">
            <h4 id="active-workspace-heading" className="text-[9px] uppercase font-mono border-l-2 border-[#c5a059] pl-2 font-black tracking-wider text-slate-400">
              {lang === 'ka' ? 'აქტიური სამუშაო სივრცე' : 'Active Winery Workspace'}
            </h4>
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="w-full sm:max-w-xs">
                <select
                  id="active-organization"
                  aria-labelledby="active-workspace-heading"
                  value={activeOrg?.id || ''}
                  onChange={async (e) => {
                    if (onSwitchOrganization) {
                      await onSwitchOrganization(e.target.value);
                    }
                  }}
                  className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded text-stone-900 font-bold outline-none cursor-pointer"
                >
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>
                      {org.name} {org.isActive ? `(${lang === 'ka' ? 'აქტიური' : 'Active'})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] text-stone-500 font-mono">
                {lang === 'ka' ? `თქვენი როლი ამ სივრცეში: ${activeOrg?.role}` : `Your role in this workspace: ${activeOrg?.role}`}
              </p>
            </div>
          </div>
        )}

        <hr className="border-stone-100" />

        {/* Team Members List */}
        <div className="space-y-4">
          <h4 className="text-[9px] uppercase font-mono border-l-2 border-[#4e0e15] pl-2 font-black tracking-wider text-slate-400">
            {lang === 'ka' ? 'გუნდის წევრები' : 'Active Team Members'}
          </h4>
          
          {loadingMembers ? (
            <div className="text-[10px] text-stone-400 animate-pulse">
              {lang === 'ka' ? 'იტვირთება წევრები…' : 'Loading team members…'}
            </div>
          ) : (
            <div className="border border-[#e8dfd5] rounded-xl overflow-hidden bg-stone-50/30">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-stone-50 border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-slate-400 font-bold">
                    <th className="p-3">{lang === 'ka' ? 'სახელი' : 'Name'}</th>
                    <th className="p-3">{lang === 'ka' ? 'ელ-ფოსტა' : 'Email'}</th>
                    <th className="p-3">{lang === 'ka' ? 'როლი' : 'Role'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-150 text-[10.5px]">
                  {members.map(member => (
                    <tr key={member.username} className="hover:bg-white transition-colors">
                      <td className="p-3 font-bold text-stone-800">{member.fullName} <span className="text-[9px] font-mono text-stone-400 font-normal">(@{member.username})</span></td>
                      <td className="p-3 text-stone-600 font-mono">{member.email}</td>
                      <td className="p-3 font-semibold text-[#4e0e15]">{member.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pending Invitations */}
        {pendingInvites.length > 0 && (
          <div className="space-y-3 pt-2">
            <h4 className="text-[9px] uppercase font-mono border-l-2 border-amber-600 pl-2 font-black tracking-wider text-slate-400">
              {lang === 'ka' ? 'გაგზავნილი მოწვევები' : 'Pending Invitations'}
            </h4>
            <div className="border border-[#e8dfd5] rounded-xl overflow-hidden bg-amber-50/10">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-amber-50/30 border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-slate-400 font-bold">
                    <th className="p-3">{lang === 'ka' ? 'ელ-ფოსტა' : 'Email'}</th>
                    <th className="p-3">{lang === 'ka' ? 'როლი' : 'Role'}</th>
                    <th className="p-3">{lang === 'ka' ? 'ვადა' : 'Expires'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-150 text-[10.5px]">
                  {pendingInvites.map(invite => (
                    <tr key={invite.id} className="hover:bg-white transition-colors">
                      <td className="p-3 text-stone-750 font-mono">{invite.email}</td>
                      <td className="p-3 font-semibold text-stone-700">{invite.role}</td>
                      <td className="p-3 text-stone-500 font-mono">{new Date(invite.expiresAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <hr className="border-stone-100" />

        {/* Invite Member Form */}
        {activeOrg?.role === 'Owner/Admin' && (
          <div className="space-y-4">
            <h4 className="text-[9px] uppercase font-mono border-l-2 border-emerald-850 pl-2 font-black tracking-wider text-slate-400">
              {lang === 'ka' ? 'ახალი წევრის მოწვევა' : 'Invite New Team Member'}
            </h4>
            <form onSubmit={handleInvite} className="space-y-4 bg-stone-50/50 p-4 border border-[#e8dfd5]/80 rounded-xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                    {lang === 'ka' ? 'ელ-ფოსტის მისამართი' : 'Email Address'}
                  </label>
                  <input
                    type="email"
                    value={invitingEmail}
                    onChange={(e) => setInvitingEmail(e.target.value)}
                    placeholder="colleague@winery.com"
                    className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-800 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                    {lang === 'ka' ? 'უფლებამოსილების როლი' : 'Clearance Role'}
                  </label>
                  <select
                    value={invitingRole}
                    onChange={(e) => setInvitingRole(e.target.value)}
                    className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 font-bold outline-none cursor-pointer"
                  >
                    <option value="Owner/Admin">Owner/Admin</option>
                    <option value="Winemaker">Winemaker</option>
                    <option value="Lab Technician">Lab Technician</option>
                    <option value="Cellar Worker">Cellar Worker</option>
                    <option value="Read-Only">Read-Only</option>
                  </select>
                </div>
              </div>

              {inviteResult && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-[10.5px] font-mono text-amber-900 break-all select-all">
                  {inviteResult}
                </div>
              )}

              <button
                type="submit"
                className="bg-[#4e0e15] hover:bg-[#34070a] text-white font-mono font-bold uppercase py-2 px-4 rounded text-[10px] tracking-wider transition-colors cursor-pointer"
              >
                ✉️ {lang === 'ka' ? 'მოწვევის გაგზავნა' : 'Send Invite'}
              </button>
            </form>
          </div>
        )}
      </div>

      {isOwnerAdmin && (
        <div className="bg-emerald-50/40 border border-emerald-200 p-6 rounded-2xl shadow-sm space-y-4 dark:bg-emerald-950/10 dark:border-emerald-900/40">
          <div>
            <h4 className="text-md font-serif font-black text-emerald-800 uppercase tracking-wide dark:text-emerald-400">
              📊 {lang === 'ka' ? 'მონაცემთა ბაზის ექსპორტი (JSON)' : 'Administrative Database Export (JSON)'}
            </h4>
            <p className="text-[10px] text-emerald-700/80 mt-1 dark:text-emerald-500">
              {lang === 'ka' 
                ? 'ჩამოტვირთეთ ყველა მომხმარებლის სრული საოპერაციო მონაცემები სამომავლო ანალიზისა და გაუმჯობესებისთვის. პაროლები და სენსიტიური გასაღებები ამოღებულია უსაფრთხოებისთვის.' 
                : 'Download full agricultural data and user configurations across all profiles for future system improvements. Passwords and API secrets are automatically stripped for security.'}
            </p>
          </div>
          <a
            href="/api/admin/export"
            download="cellarflow_export.json"
            className="w-full bg-emerald-800 hover:bg-emerald-950 text-white font-mono font-bold uppercase py-2.5 rounded-lg text-xs cursor-pointer shadow-xs transition-colors flex items-center justify-center gap-2 text-center text-decoration-none"
          >
            📥 {lang === 'ka' ? 'მონაცემთა ბაზის ჩამოტვირთვა' : 'Export and Download Database JSON'}
          </a>
        </div>
      )}

      {isOwnerAdmin && onClearAllData && (
        <div className="bg-rose-50/50 border border-rose-200 p-6 rounded-2xl shadow-sm space-y-4">
          <div>
            <h4 className="text-md font-serif font-black text-rose-800 uppercase tracking-wide">
              ⚠️ {lang === 'ka' ? 'დემო მონაცემების გასუფთავება' : 'Initialize Clean Estate (Erase Demo Data)'}
            </h4>
            <p className="text-[10px] text-rose-700/80 mt-1">
              {lang === 'ka' 
                ? 'წაშლის ყველა სადემონსტრაციო ჭურჭელს, პარტიას, ჟურნალებსა და დავალებებს, რათა დაიწყოთ მუშაობა სუფთა ფურცლიდან.' 
                : 'Permanently deletes all demo vessels, wine lots, fermentation history, viticulture blocks, and tasks so you can start with a clean slate.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const confirmText = lang === 'ka' 
                ? 'დარწმუნებული ხართ, რომ გსურთ ყველა მონაცემის წაშლა? ამ მოქმედების გაუქმება შეუძლებელია.'
                : 'Are you sure you want to erase all demo data? This action is permanent and cannot be undone.';
              if (window.confirm(confirmText)) {
                onClearAllData();
                setToastMessage(lang === 'ka' ? 'მონაცემები წარმატებით გასუფთავდა!' : 'Estate reset complete! Ready for custom data.');
              }
            }}
            className="w-full bg-rose-700 hover:bg-rose-850 text-white font-mono font-bold uppercase py-2.5 rounded-lg text-xs cursor-pointer shadow-xs transition-colors"
          >
            {lang === 'ka' ? 'ყველა სადემონსტრაციო მონაცემის წაშლა' : 'Clear All Demo/Seeded Data'}
          </button>
        </div>
      )}
    </main>
  );
}
