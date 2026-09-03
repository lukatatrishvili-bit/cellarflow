import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  Check,
  ClipboardCheck,
  CloudOff,
  Download,
  FlaskConical,
  Leaf,
  Mail,
  Menu,
  PackageCheck,
  Phone,
  ShieldCheck,
  Sprout,
  Wine,
  Workflow,
  X,
} from 'lucide-react';
import '../src/marketing.css';

type LandingLanguage = 'en' | 'ka';
type Bilingual = { en: string; ka: string };

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const copy = {
  en: {
    brandLine: 'VINEYARD → BOTTLE',
    navPlatform: 'Platform',
    navBenefits: 'Benefits',
    navIdea: 'Our idea',
    navContact: 'Contact',
    signIn: 'Sign in',
    startFree: 'Try now',
    menuLabel: 'Toggle navigation',
    languageLabel: 'Change language',
    heroEyebrow: 'THE OPERATING SYSTEM FOR WINE',
    heroLineOne: 'Every vine.',
    heroLineTwo: 'Every vessel.',
    heroLineThree: 'One living system.',
    heroCopy: 'Vineyard, cellar and laboratory—one clear system.',
    startVintage: 'Start your vintage',
    installPwa: 'Install PWA',
    unlimitedUsers: 'Unlimited cellar users',
    offlineCapable: 'Offline-capable',
    roleSecure: 'Role-secure',
    scroll: 'Scroll to explore',
    platformIndex: '01 / PLATFORM',
    platformTitleOne: 'One unified workspace.',
    platformTitleTwo: '',
    platformCopy: 'Vineyard, cellar and laboratory work stay connected.',
    benefitsIndex: '02 / CAPABILITIES',
    benefitsTitle: '',
    storyIndex: '03 / THE IDEA',
    storyTitle: 'Built for the place where tradition and precision meet.',
    storyLead: 'Georgia has made wine for 8,000 years. VinOS carries that continuity into modern cellar work.',
    trialIndex: '04 / START WITH VINOS',
    trialTitleOne: 'Try VinOS',
    trialTitleTwo: '',
    trialCopy: 'See how VinOS fits your estate. We will help you get started.',
    trialPeriod: 'MONTH FREE',
    trialButton: 'Start free trial',
    emailLabel: 'DIRECT EMAIL',
    contactFormEyebrow: 'DIRECT CONTACT',
    contactFormTitle: 'Tell me about your estate.',
    contactFormCopy: 'Send a short note and I will reply personally.',
    contactName: 'Name',
    contactNamePlaceholder: 'Your name',
    contactReply: 'Email or phone',
    contactReplyPlaceholder: 'you@winery.com',
    contactMessage: 'How can VinOS help?',
    contactMessagePlaceholder: 'Tell me briefly about your vineyard, cellar, or team.',
    mobileLabel: 'MOBILE',
    installFull: 'Install VinOS PWA',
    chromeHelp: 'Open the browser menu and choose “Install VinOS”.',
    iosHelp: 'Tap Share, then “Add to Home Screen”.',
    footerLine: 'Unified winery & vineyard control.',
    footerCopyright: 'Made for the world’s most enduring craft.',
  },
  ka: {
    brandLine: 'ვენახიდან → ბოთლამდე',
    navPlatform: 'პლატფორმა',
    navBenefits: 'შესაძლებლობები',
    navIdea: 'ჩვენი იდეა',
    navContact: 'კონტაქტი',
    signIn: 'შესვლა',
    startFree: 'გამოსცადე',
    menuLabel: 'მენიუს გახსნა',
    languageLabel: 'ენის შეცვლა',
    heroEyebrow: 'თანამედროვე მართვა მევენახეობა-მეღვინეობისთვის',
    heroLineOne: 'ვენახიდან ბოთლამდე.',
    heroLineTwo: '',
    heroLineThree: 'ყველაფერი ერთ სივრცეში.',
    heroCopy: 'ვენახი, მარანი და ლაბორატორია — ერთიან სისტემაში.',
    startVintage: 'გამოსცადეთ უფასოდ',
    installPwa: 'PWA-ის დაყენება',
    unlimitedUsers: 'შეუზღუდავი გუნდი',
    offlineCapable: 'მუშაობს ინტერნეტის გარეშეც',
    roleSecure: 'დაცული წვდომა',
    scroll: 'გაიგეთ მეტი',
    platformIndex: '01 / პლატფორმა',
    platformTitleOne: 'ერთიანი სამუშაო სივრცე.',
    platformTitleTwo: '',
    platformCopy: 'ვენახი, მარანი და ლაბორატორია ერთმანეთთანაა დაკავშირებული.',
    benefitsIndex: '02 / შესაძლებლობები',
    benefitsTitle: '',
    storyIndex: '03 / იდეა',
    storyTitle: 'ხიდი ტრადიციასა და სიზუსტეს შორის.',
    storyLead: 'საქართველოში ღვინოს 8,000 წელია აყენებენ. VinOS ამ უწყვეტობას თანამედროვე მარნის საქმიანობაში აგრძელებს.',
    trialIndex: '04 / დაიწყეთ VINOS-ით',
    trialTitleOne: 'გამოსცადეთ VinOS',
    trialTitleTwo: '',
    trialCopy: 'ნახეთ, როგორ მოერგება VinOS თქვენს მეურნეობას. დაწყებაში პირადად დაგეხმარებით.',
    trialPeriod: 'თვე უფასოდ',
    trialButton: 'უფასო ცდის დაწყება',
    emailLabel: 'ელფოსტა',
    contactFormEyebrow: 'პირდაპირი კავშირი',
    contactFormTitle: 'დაგვიკავშირდით',
    contactFormCopy: 'მოკლედ მომწერეთ და პირადად გიპასუხებთ.',
    contactName: 'სახელი',
    contactNamePlaceholder: 'თქვენი სახელი',
    contactReply: 'ელფოსტა ან ტელეფონი',
    contactReplyPlaceholder: 'you@winery.com',
    contactMessage: 'რით შეიძლება VinOS დაგეხმაროთ?',
    contactMessagePlaceholder: 'მოკლედ მომწერეთ თქვენი ვენახის, მარნის ან გუნდის შესახებ.',
    mobileLabel: 'მობილური',
    installFull: 'VinOS PWA-ის დაყენება',
    chromeHelp: 'გახსენით ბრაუზერის მენიუ და აირჩიეთ „VinOS-ის დაყენება“.',
    iosHelp: 'დააჭირეთ გაზიარებას და შემდეგ — „მთავარ ეკრანზე დამატება“.',
    footerLine: 'ვენახისა და მარნის საქმე — ერთ სივრცეში.',
    footerCopyright: 'შექმნილია ღვინის უძველესი კულტურის თანამედროვე გაგრძელებისთვის.',
  },
} as const;

const featureColumns: Array<{
  number: string;
  eyebrow: Bilingual;
  title: Bilingual;
  copy: Bilingual;
  icon: typeof Leaf;
}> = [
  {
    number: '01',
    eyebrow: { en: 'VINEYARD / VAZI', ka: 'ვენახი / ვაზი' },
    title: { en: 'Vineyard control', ka: 'ვენახის კონტროლი' },
    copy: {
      en: 'Blocks, work, weather and harvest—together.',
      ka: 'ბლოკები, სამუშაოები, ამინდი და რთველი — ერთად.',
    },
    icon: Leaf,
  },
  {
    number: '02',
    eyebrow: { en: 'CELLAR / GVINO', ka: 'მარანი / ღვინო' },
    title: { en: 'Cellar control', ka: 'მარნის კონტროლი' },
    copy: {
      en: 'Intake, vessels, fermentation and laboratory—in one view.',
      ka: 'მიღება, ჭურჭელი, დუღილი და ლაბორატორია — ერთ ხედში.',
    },
    icon: Wine,
  },
  {
    number: '03',
    eyebrow: { en: 'INTELLIGENCE / VINOS', ka: 'ანალიტიკა / VINOS' },
    title: { en: 'Analytics', ka: 'ანალიტიკა' },
    copy: {
      en: 'Traceability, costs and key decisions—clear at a glance.',
      ka: 'მიკვლევადობა, ხარჯები და მთავარი მაჩვენებლები — ერთ ხედში.',
    },
    icon: BrainCircuit,
  },
];

const benefits: Array<{
  icon: typeof Leaf;
  title: Bilingual;
}> = [
  {
    icon: Sprout,
    title: { en: 'Vineyard & weather', ka: 'ვენახი და ამინდი' },
  },
  {
    icon: ClipboardCheck,
    title: { en: 'Harvest & intake', ka: 'რთველი და მიღება' },
  },
  {
    icon: Wine,
    title: { en: 'Vessels & fermentation', ka: 'ჭურჭელი და დუღილი' },
  },
  {
    icon: FlaskConical,
    title: { en: 'Laboratory & SO₂', ka: 'ლაბორატორია და SO₂' },
  },
  {
    icon: Workflow,
    title: { en: 'Traceability & audit', ka: 'მიკვლევადობა და აუდიტი' },
  },
  {
    icon: BrainCircuit,
    title: { en: 'AI winemaker', ka: 'AI მეღვინე' },
  },
  {
    icon: PackageCheck,
    title: { en: 'Stock & costs', ka: 'მარაგები და ხარჯები' },
  },
  {
    icon: CloudOff,
    title: { en: 'Offline work', ka: 'ხაზგარეშე მუშაობა' },
  },
  {
    icon: ShieldCheck,
    title: { en: 'Team & roles', ka: 'გუნდი და როლები' },
  },
];

function LogoMark() {
  return (
    <span className="ml-logo-mark" aria-hidden="true">
      <span /><span /><span /><span /><span />
    </span>
  );
}

function VintageJourney({ language }: { language: LandingLanguage }) {
  const ka = language === 'ka';

  return (
    <div className="ml-journey ml-operations-preview" aria-label={ka ? 'VinOS-ის სამუშაო პანელის მაგალითი' : 'VinOS operations workspace preview'}>
      <div className="ml-journey-header">
        <div><LogoMark /><span>VINOS · 2026</span></div>
        <strong>{ka ? 'დღევანდელი სურათი' : 'Today at a glance'}</strong>
      </div>
      <div className="ml-ops-metrics">
        <article><Leaf size={17} /><span>{ka ? 'ვენახი' : 'Vineyard'}</span><strong>{ka ? '12 ბლოკი' : '12 blocks'}</strong></article>
        <article><Wine size={17} /><span>{ka ? 'მარანი' : 'Cellar'}</span><strong>{ka ? '18 პარტია' : '18 lots'}</strong></article>
        <article><ClipboardCheck size={17} /><span>{ka ? 'დღეს' : 'Today'}</span><strong>{ka ? '7 საქმე' : '7 tasks'}</strong></article>
      </div>
      <article className="ml-ops-block">
        <div className="ml-ops-block-head">
          <div><Leaf size={18} /><span><small>{ka ? 'ვენახის ბლოკი' : 'VINEYARD BLOCK'}</small><strong>{ka ? 'მუკუზანი · ბლოკი 04' : 'Mukuzani · Block 04'}</strong></span></div>
          <em>{ka ? 'საფერავი' : 'Saperavi'}</em>
        </div>
        <div className="ml-ops-progress-copy"><span>{ka ? 'რთველისთვის მზადყოფნა' : 'Harvest readiness'}</span><strong>78%</strong></div>
        <div className="ml-ops-progress"><i /></div>
      </article>
      <div className="ml-ops-detail-grid">
        <article className="ml-ops-detail">
          <div className="ml-ops-detail-head"><Wine size={18} /><span><small>{ka ? 'ჭურჭელი' : 'VESSEL'}</small><strong>TK-07 · Saperavi 2026</strong></span></div>
          <div className="ml-ops-readings"><span><small>{ka ? 'ტემპერატურა' : 'TEMP'}</small><strong>22.4°C</strong></span><span><small>SG</small><strong>1.042</strong></span></div>
          <div className="ml-ops-status"><i />{ka ? 'დუღილი მიმდინარეობს' : 'Fermentation active'}</div>
        </article>
        <article className="ml-ops-detail">
          <div className="ml-ops-detail-head"><FlaskConical size={18} /><span><small>{ka ? 'ლაბორატორია' : 'LABORATORY'}</small><strong>{ka ? 'ბოლო ანალიზი' : 'Latest analysis'}</strong></span></div>
          <div className="ml-ops-readings"><span><small>FREE SO₂</small><strong>28 mg/L</strong></span><span><small>pH</small><strong>3.48</strong></span></div>
          <div className="ml-ops-status"><Check size={13} />{ka ? 'მაჩვენებლები ნორმაშია' : 'Within target'}</div>
        </article>
      </div>
      <div className="ml-ops-footer"><span><i />{ka ? 'სინქრონიზებულია ახლახან' : 'Synced just now'}</span><strong>{ka ? 'ყველაფერი დაკავშირებულია' : 'All systems connected'}</strong></div>
    </div>
  );
}

export default function MarketingLanding() {
  const pageRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [language, setLanguage] = useState<LandingLanguage>(() => {
    if (typeof window === 'undefined') return 'en';
    return localStorage.getItem('vinea_lang') === 'ka' ? 'ka' : 'en';
  });
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const t = copy[language];

  useEffect(() => {
    document.title = language === 'ka' ? 'VinOS | ღვინის წარმოების ერთიანი სისტემა' : 'VinOS | The operating system for wine';
    document.documentElement.lang = language;
    document.documentElement.classList.remove('dark');
    localStorage.setItem('vinea_lang', language);
  }, [language]);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      elements.forEach(element => { element.dataset.revealed = 'true'; });
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).dataset.revealed = 'true';
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    elements.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [language]);

  useEffect(() => {
    let scrollRaf: number | null = null;
    const updateProgress = () => {
      if (scrollRaf !== null) return;
      scrollRaf = requestAnimationFrame(() => {
        const available = document.documentElement.scrollHeight - window.innerHeight;
        const progress = available > 0 ? Math.min(1, window.scrollY / available) : 0;
        pageRef.current?.style.setProperty('--scroll-progress', `${progress * 100}%`);
        scrollRaf = null;
      });
    };
    updateProgress();
    window.addEventListener('scroll', updateProgress, { passive: true });
    return () => {
      window.removeEventListener('scroll', updateProgress);
      if (scrollRaf !== null) cancelAnimationFrame(scrollRaf);
    };
  }, []);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || !pageRef.current) return;
    const { clientX, clientY } = event;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      pageRef.current?.style.setProperty('--mouse-x', `${clientX}px`);
      pageRef.current?.style.setProperty('--mouse-y', `${clientY}px`);
      pageRef.current?.style.setProperty('--shift-x', `${((clientX / width) - 0.5) * 18}px`);
      pageRef.current?.style.setProperty('--shift-y', `${((clientY / height) - 0.5) * 18}px`);
      pageRef.current?.style.setProperty('--tilt-x', `${((clientY / height) - 0.5) * -3.5}deg`);
      pageRef.current?.style.setProperty('--tilt-y', `${((clientX / width) - 0.5) * 5}deg`);
    });
  };

  const handleCardPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--card-x', `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty('--card-y', `${event.clientY - bounds.top}px`);
  };

  const install = async () => {
    if (!installPrompt) {
      setShowInstallHelp(true);
      document.querySelector('#contact')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const handleContactSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    const replyTo = String(form.get('replyTo') || '').trim();
    const message = String(form.get('message') || '').trim();
    const text = language === 'ka'
      ? `გამარჯობა, მე ვარ ${name}.\nსაკონტაქტო ინფორმაცია: ${replyTo}\n\n${message}`
      : `Hello, my name is ${name}.\nContact: ${replyTo}\n\n${message}`;
    const subject = language === 'ka' ? `VinOS — შეტყობინება ${name}-სგან` : `VinOS inquiry from ${name}`;
    window.location.href = `mailto:luka.tatrishvili@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  };

  return (
    <div className={`ml-page ${language === 'ka' ? 'lang-ka' : ''}`} ref={pageRef} onPointerMove={handlePointerMove}>
      <div className="ml-scroll-progress" aria-hidden="true" />
      <div className="ml-cursor-glow" aria-hidden="true" />
      <div className="ml-noise" aria-hidden="true" />

      <header className="ml-header">
        <a className="ml-brand" href="#top" aria-label="VinOS">
          <LogoMark />
          <span><strong>VinOS</strong><small>{t.brandLine}</small></span>
        </a>
        <nav className={menuOpen ? 'ml-nav is-open' : 'ml-nav'} aria-label={language === 'ka' ? 'მთავარი მენიუ' : 'Primary navigation'}>
          <a href="#platform" onClick={() => setMenuOpen(false)}>{t.navPlatform}</a>
          <a href="#benefits" onClick={() => setMenuOpen(false)}>{t.navBenefits}</a>
          <a href="#story" onClick={() => setMenuOpen(false)}>{t.navIdea}</a>
          <a href="#contact" onClick={() => setMenuOpen(false)}>{t.navContact}</a>
          <div className="ml-nav-mobile-actions">
            <a href="/login">{t.signIn}</a>
            <a href="/login?register=1">{t.startFree} <ArrowRight size={14} /></a>
          </div>
        </nav>
        <div className="ml-header-controls">
          <div className="ml-language-switch" aria-label={t.languageLabel}>
            <button type="button" className={language === 'en' ? 'is-active' : ''} onClick={() => setLanguage('en')} aria-pressed={language === 'en'}>EN</button>
            <button type="button" className={language === 'ka' ? 'is-active' : ''} onClick={() => setLanguage('ka')} aria-pressed={language === 'ka'}>ქარ</button>
          </div>
          <div className="ml-header-actions">
            <a className="ml-text-link" href="/login">{t.signIn}</a>
            <a className="ml-button ml-button-small" href="/login?register=1">{t.startFree} <ArrowRight size={14} /></a>
          </div>
        </div>
        <button className="ml-menu-button" type="button" onClick={() => setMenuOpen(value => !value)} aria-label={t.menuLabel} aria-expanded={menuOpen}>
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>

      <main>
        <section className="ml-hero" id="top">
          <div className="ml-tech-grid" aria-hidden="true" />
          <div className="ml-grape-field" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
          <div className="ml-vine ml-vine-left" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <div className="ml-vine ml-vine-right" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="ml-hero-copy">
            <div className="ml-eyebrow"><span /> {t.heroEyebrow}</div>
            <h1><span>{t.heroLineOne}</span>{t.heroLineTwo && <><br /><span>{t.heroLineTwo}</span></>}<br /><span><em>{t.heroLineThree}</em></span></h1>
            <p>{t.heroCopy}</p>
            <div className="ml-hero-actions">
              <a className="ml-button" href="/login?register=1">{t.startVintage} <ArrowRight size={17} /></a>
              <button className="ml-secondary-button" type="button" onClick={install}><Download size={16} /> {t.installPwa}</button>
            </div>
            <div className="ml-trust-line">
              <span><Check size={13} /> {t.unlimitedUsers}</span>
              <span><CloudOff size={13} /> {t.offlineCapable}</span>
              <span><ShieldCheck size={13} /> {t.roleSecure}</span>
            </div>
          </div>
          <div className="ml-hero-visual">
            <div className="ml-visual-halo" aria-hidden="true" />
            <VintageJourney language={language} />
          </div>
          <a className="ml-scroll-cue" href="#platform"><span>{t.scroll}</span><i /></a>
        </section>

        <section className="ml-platform" id="platform">
          <div className="ml-section-heading" data-reveal>
            <div><span>{t.platformIndex}</span><h2>{t.platformTitleOne}{t.platformTitleTwo && <><br /><em>{t.platformTitleTwo}</em></>}</h2></div>
            <p>{t.platformCopy}</p>
          </div>
          <div className="ml-feature-list">
            {featureColumns.map(({ icon: Icon, ...feature }) => (
              <article className="ml-feature" key={feature.number} data-reveal onPointerMove={handleCardPointerMove}>
                <div className="ml-feature-number">{feature.number}</div>
                <div className="ml-feature-icon"><Icon size={26} strokeWidth={1.4} /></div>
                <span>{feature.eyebrow[language]}</span>
                <h3>{feature.title[language]}</h3>
                <p>{feature.copy[language]}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="ml-benefits" id="benefits">
          <div className="ml-benefits-heading" data-reveal>
            <span>{t.benefitsIndex}</span>
          </div>
          <div className="ml-benefits-grid" data-reveal>
            {benefits.map(({ icon: Icon, title }) => (
              <article className="ml-benefit" key={title.en} onPointerMove={handleCardPointerMove}>
                <div className="ml-benefit-top"><Icon size={21} strokeWidth={1.45} /></div>
                <h3>{title[language]}</h3>
              </article>
            ))}
          </div>
        </section>

        <section className="ml-story" id="story">
          <div className="ml-story-copy" data-reveal>
            <span>{t.storyIndex}</span>
            <h2>{t.storyTitle}</h2>
            <p className="ml-story-lead">{t.storyLead}</p>
          </div>
        </section>

        <section className="ml-trial" id="contact">
          <div className="ml-trial-copy" data-reveal>
            <span>{t.trialIndex}</span>
            <h2>{t.trialTitleOne}{t.trialTitleTwo && <><br /><em>{t.trialTitleTwo}</em></>}</h2>
            <p>{t.trialCopy}</p>
          </div>
          <div className="ml-trial-card" data-reveal>
            <div className="ml-contact-heading">
              <span>{t.contactFormEyebrow}</span>
              <h3>{t.contactFormTitle}</h3>
              <p>{t.contactFormCopy}</p>
            </div>
            <form className="ml-contact-form" onSubmit={handleContactSubmit}>
              <label>
                <span>{t.contactName}</span>
                <input name="name" type="text" autoComplete="name" placeholder={t.contactNamePlaceholder} required />
              </label>
              <label>
                <span>{t.contactReply}</span>
                <input name="replyTo" type="text" autoComplete="email" placeholder={t.contactReplyPlaceholder} required />
              </label>
              <label>
                <span>{t.contactMessage}</span>
                <textarea name="message" rows={4} placeholder={t.contactMessagePlaceholder} required />
              </label>
              <div className="ml-contact-links">
                <a href="tel:+995599304205">
                  <Phone size={18} />
                  <span><small>{t.mobileLabel}</small><strong>+995 599 304 205</strong></span>
                </a>
                <button type="submit">
                  <Mail size={18} />
                  <span><small>{t.emailLabel}</small><strong>luka.tatrishvili@gmail.com</strong></span>
                </button>
              </div>
            </form>
            <div className="ml-trial-actions">
              <a className="ml-button" href="/login?register=1">{t.trialButton} <ArrowRight size={17} /></a>
              <button className="ml-secondary-button" type="button" onClick={install}><Download size={16} /> {t.installFull}</button>
            </div>
            {showInstallHelp && (
              <div className="ml-trial-install-help" role="note">
                <span><strong>Chrome / Edge</strong> {t.chromeHelp}</span>
                <span><strong>iPhone / iPad</strong> {t.iosHelp}</span>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="ml-footer">
        <div className="ml-brand"><LogoMark /><span><strong>VinOS</strong><small>{t.brandLine}</small></span></div>
        <p>{t.footerLine}</p>
        <div><a href="#platform">{t.navPlatform}</a><a href="#benefits">{t.navBenefits}</a><a href="#contact">{t.navContact}</a><a href="#contact">PWA</a><a href="/login">{t.signIn}</a></div>
        <small>© {new Date().getFullYear()} VinOS. {t.footerCopyright}</small>
      </footer>
    </div>
  );
}
