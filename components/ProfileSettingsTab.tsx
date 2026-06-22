import React from 'react';
import { translations, Language } from '../lib/i18n';
import { UserProfile, CompanyProfile } from '../lib/wineryState';

interface ProfileSettingsTabProps {
  lang: Language;
  currentUser: UserProfile;
  setCurrentUser: (val: UserProfile) => void;
  companyProfile: CompanyProfile;
  setCompanyProfile: (val: CompanyProfile) => void;
  setToastMessage: (val: string | null) => void;
  onClearAllData?: () => void;
  onUpdateProfile?: (updates: Partial<UserProfile>) => Promise<void>;
}

export default function ProfileSettingsTab({
  lang,
  currentUser,
  setCurrentUser,
  companyProfile,
  setCompanyProfile,
  setToastMessage,
  onClearAllData,
  onUpdateProfile
}: ProfileSettingsTabProps) {
  const t = translations[lang];

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

        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setCompanyProfile({
            companyName: fd.get('companyName') as string,
            wineryName: fd.get('wineryName') as string,
            country: fd.get('country') as string,
            region: fd.get('region') as string,
            municipality: fd.get('municipality') as string,
            address: fd.get('address') as string,
            contactEmail: fd.get('contactEmail') as string,
            phone: fd.get('phone') as string,
            website: fd.get('website') as string,
            measurementUnits: fd.get('units') as any,
            latitude: parseFloat(fd.get('latitude') as string) || 41.9056,
            longitude: parseFloat(fd.get('longitude') as string) || 45.4740
          });
          
          const modules = fd.getAll('enabledModules') as string[];
          const widgets = fd.getAll('enabledWidgets') as string[];
          
          if (modules.length === 0) {
            alert(lang === 'ka' ? 'გთხოვთ აირჩიოთ მინიმუმ ერთი აქტიური მოდული.' : 'Please enable at least one active module.');
            return;
          }
          
          if (onUpdateProfile) {
            onUpdateProfile({
              enabledModules: modules,
              enabledWidgets: widgets
            });
          }
          
          setToastMessage(lang === 'ka' ? 'კონფიგურაცია წარმატებით შეინახა!' : 'Configurations saved successfully!');
        }} className="space-y-4">
          
          <h4 className="text-[9px] uppercase font-mono border-l-2 border-[#4e0e15] pl-2 font-black tracking-wider text-slate-400">
            {lang === 'ka' ? 'საწარმოს ოფიციალური რეკვიზიტები' : 'Agricultural Corporate Enterprise Specifications'}
          </h4>
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

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{t.settings_country || 'Country'}</label>
              <input type="text" name="country" defaultValue={companyProfile.country} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none" />
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{t.settings_region || 'PDO Region'}</label>
              <input type="text" name="region" defaultValue={companyProfile.region} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none" />
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

          <hr className="border-stone-100" />

          <h4 className="text-[9px] uppercase font-mono border-l-2 border-emerald-800 pl-2 font-black tracking-wider text-slate-400">
            {lang === 'ka' ? 'ოპერატორის პერსონალური პროფილი და როლი' : 'Operator Profile and Clearance Privileges'}
          </h4>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'ოპერატორის სრული სახელი' : 'Operator Full Name'}</label>
              <input 
                type="text" 
                defaultValue={currentUser.fullName} 
                onChange={(e) => setCurrentUser({ ...currentUser, fullName: e.target.value })}
                className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded text-stone-900 font-bold outline-none" 
              />
            </div>
            <div>
              <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-[#4e0e15] font-bold">{lang === 'ka' ? 'აქტიური უფლებამოსილების როლი' : 'Simulated Clearance Role Privilege'}</label>
              <select 
                value={currentUser.role}
                onChange={(e) => {
                  const nextRole = e.target.value as any;
                  setCurrentUser({ ...currentUser, role: nextRole });
                  setToastMessage(lang === 'ka' ? `აქტიური როლი განახლდა: ${nextRole}` : `Simulated active clearance configured to ${nextRole}`);
                }}
                className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-extrabold text-[#4e0e15]"
              >
                <option value="Owner/Admin">👑 {t.signin_role_owner || 'Owner & ERP Admin'}</option>
                <option value="Viticulturist">🚜 {t.signin_role_viticulturist || 'Lead Viticulturist'}</option>
                <option value="Winemaker">🍷 {t.signin_role_winemaker || 'Head Winemaker'}</option>
              </select>
            </div>
          </div>

          <hr className="border-stone-100" />

          <h4 className="text-[9px] uppercase font-mono border-l-2 border-[#801323] pl-2 font-black tracking-wider text-slate-400">
            {lang === 'ka' ? 'პლატფორმის აქტიური მოდულები' : 'Workspace Active Modules Selection'}
          </h4>

          <div className="grid grid-cols-2 gap-4">
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
          </div>

          <hr className="border-stone-100" />

          <h4 className="text-[9px] uppercase font-mono border-l-2 border-amber-600 pl-2 font-black tracking-wider text-slate-400">
            {lang === 'ka' ? 'მთავარი გვერდის პორტალის ვიჯეტები' : 'Dashboard Portal Widgets Customization'}
          </h4>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { id: 'chemistry', label: lang === 'ka' ? '⚠️ უსაფრთხოება და ქიმია' : '⚠️ Safety & Chemistry Alerts' },
              { id: 'weather', label: lang === 'ka' ? '🌦️ მეტეო და ჭრაქის რისკი' : '🌦️ Weather Station & Mildew Forecasts' },
              { id: 'fermentation', label: lang === 'ka' ? '🔥 დუღილის ტელემეტრია' : '🔥 Active Fermentations & Telemetry' },
              { id: 'canopy', label: lang === 'ka' ? '🌿 ვენახის ფოთლის რადარი' : '🌿 Vineyard Canopy Status Radar' },
              { id: 'tasks', label: lang === 'ka' ? '📋 დავალებების ჩეკლისტი' : '📋 Unified Operations Tasklist' },
              { id: 'audit', label: lang === 'ka' ? '🛡️ აუდიტის ჟურნალი' : '🛡️ Immutable Audit Trail Ledger' }
            ].map(widget => (
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

          <button 
            type="submit"
            className="w-full bg-emerald-850 hover:bg-emerald-950 text-white font-mono font-bold uppercase py-2.5 rounded-lg text-xs cursor-pointer shadow-xs transition-colors"
          >
            {t.settings_save || 'Save Configurations'}
          </button>
        </form>
      </div>

      {currentUser.role === 'Owner/Admin' && (
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

      {onClearAllData && (
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
