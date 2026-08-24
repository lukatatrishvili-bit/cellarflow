'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import { Sparkles, Send, Bot, HelpCircle, Loader2, ClipboardList, CheckSquare, X, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Skeleton } from './motion';
import DateInput from './ui/DateInput';
import {
  deriveAiDraftActions,
  draftActionLabel,
  formatDraftTaskDescription,
  type AiDraftAction,
  type AiDraftQueueItem,
  type AiDraftQueueStatus
} from '../lib/aiDraftActions';

interface Props {
  lang: Language;
  cellarState: {
    tanksCount: number;
    activeFermsCount: number;
    avgTemp: number;
    lowSo2Count: number;
    highVaCount: number;
    sampleData: Array<{ id: string; lotCode: string; currentVolume: number; wineName: string; stage: string }>;
  };
  onAddNewTask?: (title: string, priority: 'high' | 'medium' | 'low', dueDate: string, description: string) => void;
  draftQueue?: AiDraftQueueItem[];
  onSaveDraftActions?: (actions: AiDraftAction[], dueDate?: string) => number | void;
  onUpdateDraftStatus?: (draftId: string, status: AiDraftQueueStatus) => void;
  contextTab?: string;
  contextModule?: string;
  className?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/** Turns of transcript sent for continuity; the server caps this again. */
const HISTORY_TURNS_SENT = 8;

interface TempTask {
  id: number;
  checked: boolean;
  title: string;
  desc: string;
  priority: 'high' | 'medium' | 'low';
}

export default function AiWinemaker({
  lang,
  cellarState,
  onAddNewTask,
  draftQueue = [],
  onSaveDraftActions,
  onUpdateDraftStatus,
  contextTab,
  contextModule,
  className
}: Props) {
  const t = translations[lang];
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load chats from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('vinea_ai_chats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      } catch (e) {
        console.error('Failed to parse saved chats:', e);
      }
    }
    // Fallback/Initial state
    setMessages([
      {
        role: 'assistant',
        content: translations[lang].ai_desc
      }
    ]);
  }, [lang]);

  // Save chats to localStorage whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('vinea_ai_chats', JSON.stringify(messages));
    }
  }, [messages]);

  // Work Order generator states
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [workOrderTasks, setWorkOrderTasks] = useState<TempTask[]>([]);
  const [taskDueDate, setTaskDueDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [showDraftActionsModal, setShowDraftActionsModal] = useState(false);
  const [showDraftQueueModal, setShowDraftQueueModal] = useState(false);
  const [draftActions, setDraftActions] = useState<AiDraftAction[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const activeDraftQueue = draftQueue.filter(item => item.status === 'draft');

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || inputMsg).trim();
    if (!query || isLoading) return;

    if (!textToSend) {
      setInputMsg('');
    }

    // Captured before the optimistic append so the transcript we send is the
    // conversation *preceding* this question, not one that already contains it.
    const priorTurns = messages.slice(-HISTORY_TURNS_SENT);
    setMessages(prev => [...prev, { role: 'user', content: query }]);
    setIsLoading(true);

    try {
      // The cellar state is deliberately not sent: the server derives the
      // winery context itself, filtered to what this user's role may open.
      const resp = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: query,
          history: priorTurns,
          stream: true,
          lang,
          contextModule,
          contextTab,
        })
      });

      if (!resp.ok || !resp.body) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Server error communicating with Gemini');
      }

      // Open an assistant bubble and stream tokens into it
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      const appendToLast = (chunk: string) =>
        setMessages(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, content: last.content + chunk };
          return copy;
        });

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamError = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith('data:')) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());
            if (payload.text) appendToLast(payload.text);
            else if (payload.error) streamError = payload.error;
          } catch {
            /* ignore */
          }
        }
      }

      if (streamError) throw new Error(streamError);
    } catch (err: any) {
      console.error(err);
      const errMsg = `⚠️ **Connection Error**: ${err.message || 'The AI Winemaker is currently unavailable. Please verify your GEMINI_API_KEY environment variable is configured.'}`;
      setMessages(prev => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant' && last.content === '') {
          copy[copy.length - 1] = { ...last, content: errMsg };
          return copy;
        }
        return [...copy, { role: 'assistant', content: errMsg }];
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateWorkOrder = (content: string) => {
    const text = content.toLowerCase();
    const isKa = lang === 'ka';
    let initialTasks: TempTask[] = [];

    if (text.includes('stuck') || text.includes('sluggish') || text.includes('restart') || text.includes('gravity') || text.includes('დუღილ') || text.includes('სიმკვრივ')) {
      initialTasks = [
        {
          id: 1,
          checked: true,
          title: isKa ? 'DAP-ის (საფუვრის კვება) დამატება გაჩერებულ დუღილში' : 'Add DAP yeast nutrients to stuck fermenter',
          desc: isKa ? 'დაამატეთ 20გ/ჰლ დიამონიუმის ფოსფატი (DAP) საფუვრის გასააქტიურებლად.' : 'Add 20g/hL Diammonium Phosphate (DAP) to stimulate yeast health.',
          priority: 'high'
        },
        {
          id: 2,
          checked: true,
          title: isKa ? 'თერმოსტატული სამიზნის კორექცია 22°C-ზე' : 'Calibrate thermostatic target to 22°C',
          desc: isKa ? 'ტკბილის ზომიერი გათბობა საფუვრის კულტურების გასააქტიურებლად.' : 'Induce mild heating to active yeast cultures in the stuck must.',
          priority: 'high'
        },
        {
          id: 3,
          checked: true,
          title: isKa ? 'ტკბილის აერაცია ტუმბვით' : 'Aerate must via aerative pumpover',
          desc: isKa ? 'ჩაატარეთ 10-წუთიანი ღია გადატუმბვა სტეროლის სინთეზის ხელშესაწყობად.' : 'Perform brief 10-minute splash pumpover to promote sterol synthesis.',
          priority: 'medium'
        }
      ];
    } else if (text.includes('qvevri') || text.includes('marani') || text.includes('wax') || text.includes('clay') || text.includes('ქვევრ') || text.includes('მარან') || text.includes('სანთელ')) {
      initialTasks = [
        {
          id: 1,
          checked: true,
          title: isKa ? 'ქვევრის სარქველის ჰერმეტულობის შემოწმება' : 'Verify clay seal integrity on Qvevri lids',
          desc: isKa ? 'შეამოწმეთ ქვევრის სარქველების ლუქი ძმრისმჟავა ბაქტერიების რისკის თავიდან ასაცილებლად.' : 'Audit sealed lids on clay jars for microscopic gas leaks or acetic acid risk.',
          priority: 'high'
        },
        {
          id: 2,
          checked: true,
          title: isKa ? 'თბილი სანთლის (ფუტკრის ცვილის) მომზადება' : 'Prepare hot beeswax for lid resealing',
          desc: isKa ? 'ქვევრის სარქველის ტრადიციული სანთლით დამუშავება ჰერმეტულობისთვის.' : 'Traditional waxing maintenance prep for Georgian marani jars.',
          priority: 'medium'
        },
        {
          id: 3,
          checked: true,
          title: isKa ? 'მარნის იატაკის დეზინფექცია კირწყლით' : 'Sanitize Marani flagstones',
          desc: isKa ? 'გარეცხეთ ქვევრის გარშემო იატაკი თბილი კირის წყლით.' : 'Cleanse surrounding stone floors with warm lime water.',
          priority: 'low'
        }
      ];
    } else if (text.includes('so2') || text.includes('sulfite') || text.includes('kmbs') || text.includes('acid') || text.includes('გოგირდ') || text.includes('მჟავ')) {
      initialTasks = [
        {
          id: 1,
          checked: true,
          title: isKa ? 'pH-ის და თავისუფალი SO2-ის გაზომვა' : 'Measure pH & Free SO2 of Cabernet Sauvignon',
          desc: isKa ? 'ღვინის pH-ის გათვალისწინებით განსაზღვრეთ თავისუფალი გოგირდის ოპტიმალური დონე.' : 'Confirm sulfur dioxide protection index relative to wine pH.',
          priority: 'high'
        },
        {
          id: 2,
          checked: true,
          title: isKa ? 'კალიუმის მეტაბისულფიტის (KMBS) დამატება' : 'Add calculated KMBS dosage to vessel',
          desc: isKa ? 'დაამატეთ კალიუმის მეტაბისულფიტი მოლეკულური SO2-ის სამიზნე დონის მისაღწევად.' : 'Increase protection to target active molecular SO2 levels.',
          priority: 'high'
        },
        {
          id: 3,
          checked: true,
          title: isKa ? 'ჭურჭლის სრული შევსება' : 'Perform volumetric topping on aging vessels',
          desc: isKa ? 'შეავსეთ თავისუფალი სივრცე ჭურჭელში ჰაერთან კონტაქტის მინიმუმამდე დასაყვანად.' : 'Fill headspace pockets to reduce oxygen contact surface area.',
          priority: 'medium'
        }
      ];
    } else {
      // Default general work order
      initialTasks = [
        {
          id: 1,
          checked: true,
          title: isKa ? 'გადამყვანი შლანგებისა და ტუმბოს დეზინფექცია' : 'Sanitize transfer hoses & pump heads',
          desc: isKa ? 'ჩაატარეთ სტანდარტული სანიტარია ოპერაციის დაწყებამდე.' : 'Execute standard pre-operation CIP sanitization protocol.',
          priority: 'medium'
        },
        {
          id: 2,
          checked: true,
          title: isKa ? 'ყოველდღიური სიმკვრივისა და ტემპერატურის აღრიცხვა' : 'Measure daily density & temp panel',
          desc: isKa ? 'აკონტროლეთ დუღილის შაქრის კლების მრუდი კინეტიკის შესამოწმებლად.' : 'Track active fermentation sugar curves to verify kinetics.',
          priority: 'medium'
        },
        {
          id: 3,
          checked: true,
          title: isKa ? 'სარდაფში ფარდობითი ტენიანობის შემოწმება' : 'Inspect barrel room relative humidity',
          desc: isKa ? 'შეინარჩუნეთ 70-75% ტენიანობა მუხის კასრებიდან აორთქლების შესამცირებლად.' : 'Target 70-75% humidity to prevent oak barrel evaporation loss.',
          priority: 'low'
        }
      ];
    }

    setWorkOrderTasks(initialTasks);
    setShowOrderModal(true);
  };

  const handleDeployTasks = () => {
    if (!onAddNewTask) return;
    const selected = workOrderTasks.filter(t => t.checked);
    selected.forEach(tk => {
      onAddNewTask(tk.title, tk.priority, taskDueDate, tk.desc);
    });
    setShowOrderModal(false);
    alert(lang === 'ka' ? `სამუშაო დავალების ${selected.length} დავალება წარმატებით გაიგზავნა მართვის სიებში!` : `Deployed ${selected.length} tasks successfully to VinOS checklist!`);
  };

  const handleReviewDraftActions = (content: string) => {
    const actions = deriveAiDraftActions(content, { contextModule, contextTab, cellarState, lang });
    setDraftActions(actions);
    setSelectedDraftIds(actions.map(action => action.id));
    setShowDraftActionsModal(true);
  };

  const handleToggleDraft = (id: string) => {
    setSelectedDraftIds(prev => (
      prev.includes(id) ? prev.filter(existing => existing !== id) : [...prev, id]
    ));
  };

  const handleCreateDraftTasks = () => {
    if (!onAddNewTask) return;
    const selected = draftActions.filter(action => selectedDraftIds.includes(action.id));
    selected.forEach(action => {
      const taskTitle = action.type === 'task' ? action.title : (lang === 'ka' ? `AI პროექტის განხილვა: ${action.title}` : `Review AI draft: ${action.title}`);
      onAddNewTask(taskTitle, action.priority, taskDueDate, formatDraftTaskDescription(action, lang));
    });
    setShowDraftActionsModal(false);
    alert(lang === 'ka' ? `შეიქმნა ${selected.length} შემოწმებული AI დავალების პროექტი.` : `Created ${selected.length} reviewed AI draft tasks.`);
  };

  const handleSaveDraftQueue = () => {
    if (!onSaveDraftActions) return;
    const selected = draftActions.filter(action => selectedDraftIds.includes(action.id));
    const count = onSaveDraftActions(selected, taskDueDate) || selected.length;
    setShowDraftActionsModal(false);
    alert(lang === 'ka' ? `შენახულია ${count} AI სამუშაო ვერსია განსახილველად.` : `Saved ${count} AI draft action${count === 1 ? '' : 's'} for review.`);
  };

  const handleCreateQueuedTask = (action: AiDraftQueueItem) => {
    if (!onAddNewTask) return;
    const taskTitle = action.type === 'task' ? action.title : (lang === 'ka' ? `AI პროექტის განხილვა: ${action.title}` : `Review AI draft: ${action.title}`);
    onAddNewTask(taskTitle, action.priority, action.dueDate || taskDueDate, formatDraftTaskDescription(action, lang));
    onUpdateDraftStatus?.(action.id, 'converted_to_task');
  };

  const quickPrompts = useMemo(() => {
    const isKa = lang === 'ka';
    const defaultPrompts = [
      {
        label: isKa ? 'დუღილის შეფერხება' : 'Stuck Ferment Protocol',
        query: isKa
          ? 'ჩემი კაბერნე სოვინიონის EC-1118 დუღილი შენელებულია 1.015 სიმკვრივეზე. გთხოვთ, მომაწოდოთ დუღილის აღდგენის ნაბიჯ-ნაბიჯ პროტოკოლი.'
          : 'My Cabernet Sauvignon EC-1118 fermentation is sluggish at 1.015 density. Present a step-by-step stuck fermentation restart protocol.'
      },
      {
        label: isKa ? 'ქვევრის ცვილით დამუშავება' : 'Qvevri Clay Waxing',
        query: isKa
          ? 'ამიხსენით ქართული ტრადიციული მარნის ქვევრის ცვილით/სანთლით დამუშავების წესები, ჰიგიენის პრაქტიკა და კირის წყლით დეზინფექცია.'
          : 'Explain traditional Georgian Marani Qvevri waxing preparation, hygiene practices, and limestone water sanitation.'
      },
      {
        label: isKa ? 'სულფიდი/pH კავშირი' : 'Sulfide/pH Interaction',
        query: isKa
          ? 'რატომ განსაზღვრავს ღვინის pH თავისუფალი SO2-ის სამიზნე რაოდენობას? ამიხსენით კავშირი მოლეკულურ SO2-სა და კალიუმის მეტაბისულფიტის (KMBS) ქიმიას შორის.'
          : 'Why does wine pH dictate free SO2 targets? Explain molecular SO2 correlation and KMBS chemistry.'
      },
      {
        label: isKa ? 'მარნის აუდიტი და გამოსწორება' : 'Cellar Audit Remediation',
        query: isKa
          ? 'შეამოწმეთ ჩემი მარნის მიმდინარე სტატისტიკა. მირჩიეთ სასწრაფო ქმედებები დაბალი SO2-ის ან მაღალი ქროლადი მჟავიანობის (VA) გაფრთხილებებზე.'
          : 'Inspect my current cellar stats. Suggest immediate actions for any low SO2 or high VA warnings.'
      }
    ];

    if (contextModule === 'vazi') {
      return [
        {
          label: isKa ? 'ჭრაქის რისკი და ამინდი' : 'Mildew Risk Weather',
          query: isKa
            ? 'როგორ იწვევს ტემპერატურა და ტენიანობა ჭრაქის გავრცელებას? რა არის ზღვრული მნიშვნელობები?'
            : 'How do temperature and humidity trigger downy mildew infections? What are the threshold values?'
        },
        {
          label: isKa ? 'ფოთლოვანი მასის მართვა სიცხეში' : 'Canopy Heat Management',
          query: isKa
            ? 'რა არის მწვანე ოპერაციების (ფოთლების შეცლა, ტოტების შეჭრა) საუკეთესო პრაქტიკა ექსტრემალური სიცხის დროს?'
            : 'What are the best canopy management actions (e.g. leaf pulling, thinning) during severe hot weather trends?'
        },
        {
          label: isKa ? 'GDD და ფენოლოგიური ფაზები' : 'GDD Phenological Stages',
          query: isKa
            ? 'ამიხსენით აქტიური ტემპერატურების ჯამის (GDD) დაგროვების დიაპაზონი ძირითადი ფენოლოგიური ფაზებისთვის: ყვავილობა, გამონასკვა, შეფერილობა.'
            : 'Explain the heat sum (GDD) accumulation ranges for key grapevine phenological stages like flowering, fruit set, and veraison.'
        },
        {
          label: isKa ? 'ქართული საფერავის მწვანე ოპერაციები' : 'Georgian Saperavi Canopy',
          query: isKa
            ? 'რა არის საფერავის უნიკალური მწვანე ოპერაციების და აერაციის მოთხოვნები კახეთის რეგიონში?'
            : 'What are the unique canopy management and aeration requirements for Saperavi grape vines in Kakheti?'
        }
      ];
    }

    if (contextTab === 'vessels') {
      return [
        {
          label: isKa ? 'რეზერვუარების ტემპ. კონტროლი' : 'Vessel Temp Regulation',
          query: isKa
            ? 'მირჩიეთ ოპტიმალური ტემპერატურის სამიზნეები და დუღილის მართვის რეჟიმები თეთრი და წითელი ღვინისთვის რეზერვუარებში.'
            : 'Suggest optimal temperature targets and fermentation management routines for white vs red wine vessels.'
        },
        {
          label: isKa ? 'კასრების და ქვევრების სანიტარია' : 'Oak Barrel Sanitation',
          query: isKa
            ? 'რა არის სტანდარტული სანიტარიის და მომზადების პროტოკოლი ბეტონის ავზებისა და მუხის კასრებისთვის ხელახალ შევსებამდე?'
            : 'What is the standard cellar sanitation and prep protocol for concrete tanks vs oak barrels before refilling?'
        },
        {
          label: isKa ? 'რეზერვუარების შევსების წესი' : 'Volume Topping Routine',
          query: isKa
            ? 'რატომ არის თავისუფალი სივრცის კონტროლი კრიტიკული დაძველებისას? აღწერეთ შევსების სწორი გრაფიკი.'
            : 'Why is headspace/ullage control critical in aging vessels? Outline a proper topping schedule.'
        },
        {
          label: isKa ? 'KMBS დოზირების გამოთვლა' : 'KMBS Dosage Calculation',
          query: isKa
            ? 'როგორ გამოვთვალო კალიუმის მეტაბისულფიტის (KMBS) დოზირება რეზერვუარში სულფიტების ოპტიმალური დონისთვის?'
            : 'Outline how to calculate potassium metabisulfite (KMBS) dosage for clean sulfite protection in a tank.'
        }
      ];
    }

    if (contextTab === 'fermentation') {
      return [
        {
          label: isKa ? 'დუღილის გაჩერების ნიშნები' : 'Stuck Fermentation Symptoms',
          query: isKa
            ? 'რა არის დუღილის შენელების ან გაჩერების ადრეული ნიშნები (მაგ. სიმკვრივის ცვლილების ყოველდღიური მრუდი)?'
            : 'What are the early warning signs that a fermentation is becoming sluggish or stuck (e.g. density, daily slope)?'
        },
        {
          label: isKa ? 'კვების დამატების გრაფიკი' : 'Nutrient Feed Schedule',
          query: isKa
            ? 'შემომთავაზეთ საფუვრების კვების (DAP/ორგანული) დამატების გრაფიკი მაღალშაქრიანი ტკბილისთვის გაჩერების თავიდან ასაცილებლად.'
            : 'Suggest a yeast nutrient (DAP/Organic) addition schedule for high-brix must to prevent stuck states.'
        },
        {
          label: isKa ? 'ტემპერატურული ციკლი' : 'Fermentation Temperature Loops',
          query: isKa
            ? 'როგორ მოქმედებს ტემპერატურის მკვეთრი ცვლილება საფუვრების მეტაბოლიზმზე და როგორ შევინარჩუნოთ ტემპერატურის კონტროლი?'
            : 'Explain how temperature spikes or drops affect yeast metabolism and how to maintain the thermal intelligence loop.'
        },
        {
          label: isKa ? 'ღვინის სიმშრალის დასტური' : 'Wine Dryness Criteria',
          query: isKa
            ? 'როგორ ადასტურებს მეღვინე მათემატიკურად და სენსორულად, რომ ღვინის პარტია სრულად დადუღდა (მშრალია)?'
            : 'How does a winemaker mathematically and sensorially confirm a wine lot is completely dry?'
        }
      ];
    }

    if (contextTab === 'transfers') {
      return [
        {
          label: isKa ? 'უსაფრთხო საიდან/სად გეგმა' : 'Safe Source/Destination Plan',
          query: isKa
            ? 'მოამზადეთ ამ ღვინის გადატანის განსახილველი გეგმა: შეამოწმეთ საიდან და სად ჭურჭლები, ტევადობა, პარტიის იდენტობა, სისუფთავე და მოსალოდნელი დანაკარგი.'
            : 'Prepare a review-only wine transfer plan: confirm source and destination vessels, headroom, lot identity, sanitation, and expected loss.',
        },
        {
          label: isKa ? 'გადატანის რისკები' : 'Transfer Risk Check',
          query: isKa
            ? 'შეაფასეთ ჟანგბადის, ლექის, ტემპერატურის, ტუმბოსა და შლანგის სანიტარიის რისკები ამ გადატანამდე.'
            : 'Assess oxygen, lees, temperature, pump, and hose-sanitation risks before this transfer.',
        },
        {
          label: isKa ? 'დანამატების საჭიროება' : 'Transfer Additives',
          query: isKa
            ? 'გადატანის შემდეგ რომელი დანამატები შეიძლება გახდეს საჭირო და რომელი ლაბორატორიული შედეგები უნდა დადასტურდეს დოზირებამდე?'
            : 'Which post-transfer additions may be needed, and which lab results must be confirmed before dosing?',
        },
      ];
    }

    if (contextTab === 'bottling') {
      return [
        {
          label: isKa ? 'ჩამოსხმის მზადყოფნა' : 'Bottling Readiness',
          query: isKa
            ? 'შექმენით ჩამოსხმის მზადყოფნის განსახილველი სია: ლაბორატორიული გამოშვება, ფილტრაცია, ბოთლი, საცობი, ჩაჩი, ეტიკეტი, ყუთი და საწყობი.'
            : 'Create a review-only bottling readiness checklist covering lab release, filtration, bottle, closure, capsule, label, box, and storage.',
        },
        {
          label: isKa ? 'შეფუთვის დეფიციტი' : 'Packaging Shortfall',
          query: isKa
            ? 'შეამოწმეთ ჩამოსხმისთვის საჭირო შეფუთვის პროდუქტების კატეგორიები, რაოდენობები და შესაძლო დეფიციტი.'
            : 'Review packaging product categories, required quantities, and likely shortfalls for this bottling run.',
        },
        {
          label: isKa ? 'ჩამოსხმის რისკები' : 'Bottling Risk Gate',
          query: isKa
            ? 'რომელი ხარისხის, მიკრობიოლოგიური და მიკვლევადობის პირობები უნდა დაიხუროს ამ პარტიის ჩამოსხმამდე?'
            : 'Which quality, microbiological, and traceability gates must close before bottling this lot?',
        },
      ];
    }

    if (contextTab === 'inventory') {
      return [
        {
          label: isKa ? 'მარაგის შევსების გეგმა' : 'Restock Plan',
          query: isKa
            ? 'მოამზადეთ პროდუქტების მარაგის შევსების განსახილველი გეგმა მინიმალური ზღვრების, დაგეგმილი ოპერაციებისა და მიწოდების ვადების მიხედვით.'
            : 'Prepare a review-only product restock plan using minimum thresholds, scheduled operations, and supplier lead times.',
        },
        {
          label: isKa ? 'კატეგორიების აუდიტი' : 'Category Audit',
          query: isKa
            ? 'შეამოწმეთ, სწორ კატეგორიებშია თუ არა ბოთლები, საცობები, კაფსულები, ეტიკეტები, ყუთები და დანამატები.'
            : 'Audit whether bottles, closures, capsules, labels, boxes, and additives are assigned to the correct categories.',
        },
        {
          label: isKa ? 'მომავალი დეფიციტი' : 'Forecast Shortage',
          query: isKa
            ? 'რომელი პროდუქტები შეიძლება დაგვაკლდეს უახლოესი სამუშაოებისა და ჩამოსხმების მიხედვით? ჩამომიწერეთ მხოლოდ განსახილველი შეკვეთის პროექტი.'
            : 'Which products may run short based on upcoming work and bottling? Draft a review-only reorder proposal.',
        },
      ];
    }

    if (contextTab === 'calculators') {
      return [
        {
          label: isKa ? 'რძემჟავას დოზის შემოწმება' : 'Lactic Acid Dose Review',
          query: isKa
            ? 'მომიმზადეთ რძემჟავას კორექციის პროექტი მოცულობის, მიმდინარე/სამიზნე TA-ის, ხსნარის სისუფთავისა და სიმკვრივის შემოწმებით.'
            : 'Prepare a lactic-acid adjustment draft using volume, current/target TA, solution purity, and density.',
        },
        {
          label: isKa ? 'YAN კვების გეგმა' : 'YAN Nutrition Plan',
          query: isKa
            ? 'მომიმზადეთ YAN-ზე დაფუძნებული საფუარის კვების პროექტი და ჩამომიწერეთ რა მონაცემები უნდა გადავამოწმო დოზირებამდე.'
            : 'Prepare a YAN-based yeast nutrition draft and list the inputs that must be confirmed before dosing.',
        },
        {
          label: isKa ? 'საცდელი დოზის მასშტაბირება' : 'Scale Bench Dose',
          query: isKa
            ? 'ამიხსენით როგორ გადავიყვანო გ/ჰლ საცდელი დოზა მთლიანი პარტიის პროდუქტად და სამუშაო ხსნარის მოცულობად.'
            : 'Explain how to scale a g/hL bench dose to total product mass and working-solution volume.',
        },
        {
          label: isKa ? 'აქტიური SO₂' : 'Active SO₂ Review',
          query: isKa
            ? 'შეამოწმეთ აქტიური და თავისუფალი SO₂-ის სამიზნეები pH-ის, ტემპერატურისა და ალკოჰოლის მიხედვით.'
            : 'Review active and free SO₂ targets using pH, temperature, and alcohol.',
        },
      ];
    }

    if (contextTab === 'labs') {
      return [
        {
          label: isKa ? 'ქროლადი მჟავიანობის საფრთხეები' : 'High Volatile Acidity Dangers',
          query: isKa
            ? 'რა იწვევს მაღალ ქროლად მჟავიანობას (VA) დაძველებისას და როგორ შეგვიძლია მისი შემცირება გოგირდის ან ფილტრაციის გამოყენებით?'
            : 'What causes high Volatile Acidity (VA) in aging wines and how can we mitigate it using sulfur dioxide or filtration?'
        },
        {
          label: isKa ? 'მოლეკულური SO2-ის გზამკვლევი' : 'Molecular SO2 Guide',
          query: isKa
            ? 'ამიხსენით მათემატიკური კავშირი ღვინის pH-ს, ტემპერატურას, თავისუფალ SO2-სა და მოლეკულურ SO2-ს შორის.'
            : 'Explain the mathematical relationship between wine pH, temperature, free SO2, and molecular SO2.'
        },
        {
          label: isKa ? 'მჟავიანობის კორექცია (ღვინისმჟავა)' : 'Acid Adjustments (Tartaric)',
          query: isKa
            ? 'რა არის ქიმიური გაანგარიშება და პროცედურა ღვინისმჟავის დამატებისას საერთო მჟავიანობის ასამაღლებლად?'
            : 'What is the chemical calculation and process to execute a tartaric acid addition to raise acidity?'
        },
        {
          label: isKa ? 'FSO2-ის კლების ტემპები' : 'FSO2 Depletion Rates',
          query: isKa
            ? 'რატომ კლებულობს თავისუფალი SO2 სწრაფად კასრებში დაძველებისას და რა სიხშირით უნდა შევამოწმოთ მისი დონე?'
            : 'Why does free SO2 deplete rapidly in barrel aging, and what is the target schedule to maintain protective levels?'
        }
      ];
    }

    if (contextModule === 'docs' || contextModule === 'certification' || contextTab === 'docs') {
      return [
        {
          label: isKa ? 'ცარიელი ველების განმარტება' : 'Explain Missing Fields',
          query: isKa
            ? 'განმარტეთ, რა ოფიციალური ქართული დოკუმენტის ველებია გამოტოვებული, რომელი მოდულებიდან ივსება ისინი და რომელი ხარვეზები აფერხებს ექსპორტს.'
            : 'Explain what official Georgian document fields are missing, which source modules should fill them, and which gaps block export submission.'
        },
        {
          label: isKa ? 'სერტიფიცირების მზადყოფნა' : 'Certification Readiness',
          query: isKa
            ? 'გადახედეთ სერტიფიცირებისთვის მზადყოფნას და ჩამოწერეთ გამოტოვებული ლაბორატორიული, ნიმუშების, ნაშთების და დოკუმენტების მტკიცებულებები შავი ვერსიების სახით.'
            : 'Review certification readiness and list missing lab, sample, balance, certificate, and document evidence as review-only draft actions.'
        },
        {
          label: isKa ? 'დეკლარირების ექსპორტის გაფრთხილებები' : 'Annex Export Warnings',
          query: isKa
            ? 'განმარტეთ დანართის ექსპორტის გაფრთხილებები და განაცალკევეთ კრიტიკული გამოტოვებული მონაცემები ნაკლებად მნიშვნელოვანი გაფრთხილებებისგან.'
            : 'Explain Annex export warnings and separate critical missing data from non-blocking review warnings.'
        },
        {
          label: isKa ? 'ლოტის დოკუმენტების წყაროები' : 'Lot Document Sources',
          query: isKa
            ? 'შეაჯამეთ, რომელი ლოტის, ყურძნის მიღების, ვენახის, ლაბორატორიის, ჩამოსხმის და გაყიდვების ჩანაწერებიდან ივსება ოფიციალური დოკუმენტის ველები.'
            : 'Summarize which lot, intake, vineyard, lab, bottling, and sales records feed official document fields.'
        }
      ];
    }

    return defaultPrompts;
  }, [contextTab, contextModule, lang]);

  return (
    <div className={`flex flex-col bg-white border border-[#e8dfd5] rounded-xl overflow-hidden shadow-sm relative ${className || 'h-[520px]'}`}>
      {/* Header */}
      <div className="px-5 py-4 bg-gradient-to-r from-[#4e0e15] to-[#3a0a0f] text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-amber-400" />
          <div>
            <h3 className="text-sm font-semibold font-serif tracking-wide">{t.ai_assistant} (Gemini)</h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDraftQueueModal(true)}
            className="px-2 py-0.5 bg-[#ffffff1d] hover:bg-[#ffffff30] text-[10px] rounded text-stone-100 flex items-center gap-1 transition-colors cursor-pointer border-0"
            title={lang === 'ka' ? 'შენახული AI შავი სამუშაოების ნახვა' : 'Review saved AI drafts'}
          >
            {lang === 'ka' ? 'რიგი' : 'Queue'} {activeDraftQueue.length}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(lang === 'ka' ? 'გსურთ ჩატის ისტორიის წაშლა?' : 'Clear enological chat history?')) {
                localStorage.removeItem('vinea_ai_chats');
                setMessages([
                  {
                    role: 'assistant',
                    content: translations[lang].ai_desc
                  }
                ]);
              }
            }}
            className="px-2 py-0.5 bg-[#ffffff1d] hover:bg-[#ffffff30] text-[10px] rounded text-stone-100 flex items-center gap-1 transition-colors cursor-pointer border-0"
            title={lang === 'ka' ? 'ჩატის ისტორიის გასუფთავება' : 'Clear Chat History'}
          >
            {lang === 'ka' ? 'გასუფთავება' : 'Clear History'}
          </button>
          <div className="px-2 py-0.5 bg-[#ffffff1d] text-[10px] rounded text-stone-100 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-300" /> {lang === 'ka' ? 'აქტიური სინქრონიზაცია' : 'Active Cellar Sync'}
          </div>
        </div>
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-[#FAF8F5] to-white">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex gap-3 max-w-[85%] ${m.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs shrink-0 select-none ${
              m.role === 'user' ? 'bg-[#c5a059] text-white' : 'bg-[#4e0e15] text-white'
            }`}>
              {m.role === 'user' ? 'U' : <Bot className="w-4 h-4" />}
            </div>
            <div className="space-y-1.5 min-w-0">
              <div className={`rounded-xl px-4 py-3 text-xs leading-relaxed shadow-3xs ${
                m.role === 'user'
                  ? 'bg-[#c5a059]/10 text-stone-850 border border-[#c5a059]/20 rounded-tr-none'
                  : 'bg-[#f4efe9] text-[#2c241e] border border-[#e3d7cb] rounded-tl-none'
              }`}>
                <div className="markdown-chat prose prose-sm max-w-none prose-stone dark:prose-invert">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              </div>

              {/* Work order and Draft actions buttons */}
              {m.role === 'assistant' && m.content && !m.content.includes('⚠️ **Connection Error**') && (
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => handleReviewDraftActions(m.content)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded text-[10px] font-bold font-mono transition-colors shadow-2xs cursor-pointer border border-stone-200"
                  >
                    🔍 {lang === 'ka' ? 'შავი სამუშაოების განხილვა' : 'Review Draft Actions'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGenerateWorkOrder(m.content)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-[#4e0e15] hover:bg-[#801323] text-white rounded text-[10px] font-bold font-mono transition-colors shadow-2xs cursor-pointer"
                  >
                    📋 {lang === 'ka' ? 'სამუშაო დავალების გენერირება' : 'Generate Work Order'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3 max-w-[85%]">
            <div className="bg-[#f4efe9] text-[#2c241e] border border-[#e3d7cb] rounded-lg rounded-bl-none p-3.5 space-y-2.5 w-full">
              <div className="flex items-center gap-2 text-[10px] text-[#4e0e15] font-bold font-mono">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4e0e15]" />
                <span>{t.ai_thinking || 'Gemini Winemaker Advisor thinking...'}</span>
              </div>
              <Skeleton className="h-4 w-11/12 rounded" />
              <Skeleton className="h-4 w-5/6 rounded" />
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-2/3 rounded" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick Prompts Shelf */}
      <div className="px-4 py-2 bg-[#fbfaf8] border-t border-[#f0e6da] flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1 pr-1">
          <HelpCircle className="w-3 h-3 text-slate-400" /> {lang === 'ka' ? 'იკითხეთ:' : 'Ask about:'}
        </span>
        {quickPrompts.map((qp, i) => (
          <button
            key={i}
            onClick={() => handleSend(qp.query)}
            disabled={isLoading}
            className="text-[10px] px-2.5 py-1 bg-white border border-[#e8dfd5] hover:border-[#4e0e15] hover:text-[#4e0e15] text-slate-655 rounded-full transition-colors font-semibold disabled:opacity-50 cursor-pointer"
          >
            {qp.label}
          </button>
        ))}
      </div>

      {/* Input panel */}
      <div className="p-3 bg-white border-t border-[#f0e6da] flex gap-2">
        <input
          type="text"
          value={inputMsg}
          onChange={(e) => setInputMsg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          disabled={isLoading}
          placeholder={t.ai_ask_placeholder}
          className="flex-1 px-3.5 py-2 text-xs bg-[#FAF8F5] border border-slate-200 focus:border-[#4e0e15] rounded outline-none"
        />
        <button
          onClick={() => handleSend()}
          disabled={isLoading || !inputMsg.trim()}
          className="p-2 bg-[#4e0e15] hover:bg-[#6b151e] text-white rounded cursor-pointer transition-colors disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Work Order Generator Modal */}
      {showOrderModal && (
        <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded-xl shadow-2xl w-full max-w-md max-h-[90%] flex flex-col overflow-hidden text-stone-850">
            {/* Header */}
            <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ClipboardList className="w-4 h-4 text-[#4e0e15]" />
                <strong className="text-xs font-serif font-black uppercase tracking-wider text-[#4e0e15]">
                  {lang === 'ka' ? 'AI მარნის სამუშაო დავალება' : 'AI Cellar Work Order'}
                </strong>
              </div>
              <button
                type="button"
                onClick={() => setShowOrderModal(false)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content list */}
            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              <p className="text-[10px] text-stone-500 leading-normal">
                {lang === 'ka' ? 'დაამატეთ ეს რეკომენდებული დავალებები მარნის სამუშაო სიას Gemini-ს რეკომენდაციების საფუძველზე:' : 'Deploy these recommended tasks to the winery check-list scheduler based on Gemini enological feedback:'}
              </p>

              <div className="space-y-2.5">
                {workOrderTasks.map((tk) => (
                  <div key={tk.id} className="p-2.5 border border-stone-200 bg-[#FCFAF9] rounded-lg space-y-1.5">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={tk.checked}
                        onChange={(e) => setWorkOrderTasks(prev => prev.map(p => p.id === tk.id ? { ...p, checked: e.target.checked } : p))}
                        className="w-3.5 h-3.5 accent-[#4e0e15] cursor-pointer mt-0.5"
                      />
                      <div className="flex-1 space-y-0.5">
                        <input
                          type="text"
                          value={tk.title}
                          onChange={(e) => setWorkOrderTasks(prev => prev.map(p => p.id === tk.id ? { ...p, title: e.target.value } : p))}
                          className="w-full text-xs font-bold bg-transparent border-0 outline-none text-[#231f1d] focus:underline"
                        />
                        <textarea
                          rows={2}
                          value={tk.desc}
                          onChange={(e) => setWorkOrderTasks(prev => prev.map(p => p.id === tk.id ? { ...p, desc: e.target.value } : p))}
                          className="w-full text-[10.5px] leading-relaxed text-stone-550 bg-transparent border-0 outline-none resize-none focus:underline"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-stone-100 pt-1.5 text-[9.5px]">
                      <span className="text-slate-400 font-mono">{lang === 'ka' ? 'პრიორიტეტი:' : 'Priority:'}</span>
                      <select
                        value={tk.priority}
                        onChange={(e) => setWorkOrderTasks(prev => prev.map(p => p.id === tk.id ? { ...p, priority: e.target.value as any } : p))}
                        className="px-1.5 py-0.5 border border-stone-200 rounded bg-white text-[9.5px] font-bold"
                      >
                        <option value="high">{lang === 'ka' ? 'მაღალი' : 'High'}</option>
                        <option value="medium">{lang === 'ka' ? 'საშუალო' : 'Medium'}</option>
                        <option value="low">{lang === 'ka' ? 'დაბალი' : 'Low'}</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              {/* Due Date */}
              <div className="border-t border-stone-150 pt-3 flex items-center justify-between text-[11px]">
                <span className="text-stone-500 font-bold">{lang === 'ka' ? 'შესრულების ვადა:' : 'Scheduled Due Date:'}</span>
                <DateInput
                  lang={lang}
                  value={taskDueDate}
                  onValueChange={setTaskDueDate}
                  className="px-2 py-1 border border-stone-200 rounded font-bold text-xs"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 bg-stone-50 border-t border-stone-200 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowOrderModal(false)}
                className="px-3 py-1.5 border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-bold rounded-lg cursor-pointer transition-colors"
              >
                {lang === 'ka' ? 'გაუქმება' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleDeployTasks}
                className="px-3 py-1.5 bg-[#4e0e15] hover:bg-[#801323] text-white text-xs font-bold rounded-lg cursor-pointer transition-colors flex items-center gap-1 shadow-xs"
              >
                <Check className="w-3.5 h-3.5" />
                {lang === 'ka' ? 'დავალებების დამატება' : 'Deploy Selected Tasks'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review-only draft actions modal */}
      {showDraftActionsModal && (
        <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded-xl shadow-2xl w-full max-w-lg max-h-[90%] flex flex-col overflow-hidden text-stone-850">
            <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <CheckSquare className="w-4 h-4 text-[#4e0e15]" />
                <strong className="text-xs font-serif font-black uppercase tracking-wider text-[#4e0e15]">
                  {lang === 'ka' ? 'AI შავი სამუშაოები' : 'AI Draft Actions'}
                </strong>
              </div>
              <button
                type="button"
                onClick={() => setShowDraftActionsModal(false)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-[10.5px] leading-relaxed text-amber-900">
                {lang === 'ka' ? 'სამუშაო ვერსიები განკუთვნილია მხოლოდ განსახილველად. დავალების შექმნა ამატებს მას სიას; ის არ ანახლებს ლაბორატორიულ, ვენახის, დოკუმენტების ან პარტიის ჩანაწერებს.' : 'Drafts are staged for review only. Creating task drafts adds checklist items; it does not update lab, vineyard, document, lot, or cellar-operation records.'}
              </div>

              <div className="space-y-2.5">
                {draftActions.map(action => (
                  <label key={action.id} className="block p-3 border border-stone-200 bg-[#FCFAF9] rounded-lg space-y-2 cursor-pointer">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedDraftIds.includes(action.id)}
                        onChange={() => handleToggleDraft(action.id)}
                        className="w-3.5 h-3.5 accent-[#4e0e15] cursor-pointer mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider font-mono font-black text-[#4e0e15]">
                            {draftActionLabel(action.type, lang)}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[8.5px] uppercase font-black font-mono ${
                            action.priority === 'high'
                              ? 'bg-rose-100 text-rose-700'
                              : action.priority === 'medium'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {action.priority === 'high' ? (lang === 'ka' ? 'მაღალი' : 'high') : action.priority === 'medium' ? (lang === 'ka' ? 'საშუალო' : 'medium') : (lang === 'ka' ? 'დაბალი' : 'low')}
                          </span>
                        </div>
                        <h4 className="mt-1 text-xs font-bold text-[#231f1d] leading-snug">
                          {action.title}
                        </h4>
                        <p className="mt-1 text-[10.5px] leading-relaxed text-stone-550">
                          {action.description}
                        </p>
                      </div>
                    </div>

                    {action.warnings.length > 0 && (
                      <ul className="pl-5 space-y-1 text-[9.5px] leading-relaxed text-[#801323] font-bold">
                        {action.warnings.map(warning => (
                          <li key={warning}>⚠️ {warning}</li>
                        ))}
                      </ul>
                    )}
                  </label>
                ))}
              </div>

              <div className="border-t border-stone-150 pt-3 flex items-center justify-between text-[11px]">
                <span className="text-stone-500 font-bold">{lang === 'ka' ? 'დავალების ვადა:' : 'Task Due Date:'}</span>
                <DateInput
                  lang={lang}
                  value={taskDueDate}
                  onValueChange={setTaskDueDate}
                  className="px-2 py-1 border border-stone-200 rounded font-bold text-xs"
                />
              </div>
            </div>

            <div className="px-4 py-3 bg-stone-50 border-t border-stone-200 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowDraftActionsModal(false)}
                className="px-3 py-1.5 border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-bold rounded-lg cursor-pointer transition-colors"
              >
                {lang === 'ka' ? 'დახურვა' : 'Close'}
              </button>
              <button
                type="button"
                onClick={handleCreateDraftTasks}
                disabled={!onAddNewTask || selectedDraftIds.length === 0}
                className="px-3 py-1.5 bg-[#4e0e15] hover:bg-[#801323] text-white text-xs font-bold rounded-lg cursor-pointer transition-colors flex items-center gap-1 shadow-xs disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                {lang === 'ka' ? 'შერჩეული დავალებების შექმნა' : 'Create Selected Task Drafts'}
              </button>
              <button
                type="button"
                onClick={handleSaveDraftQueue}
                disabled={!onSaveDraftActions || selectedDraftIds.length === 0}
                className="px-3 py-1.5 bg-stone-850 hover:bg-stone-900 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors flex items-center gap-1 shadow-xs disabled:opacity-50"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                {lang === 'ka' ? 'შავ ვერსიებში შენახვა' : 'Save to Draft Queue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent draft queue modal */}
      {showDraftQueueModal && (
        <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded-xl shadow-2xl w-full max-w-lg max-h-[90%] flex flex-col overflow-hidden text-stone-850">
            <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <CheckSquare className="w-4 h-4 text-[#4e0e15]" />
                <strong className="text-xs font-serif font-black uppercase tracking-wider text-[#4e0e15]">
                  {lang === 'ka' ? 'შენახული AI ვერსიების რიგი' : 'Saved AI Draft Queue'}
                </strong>
              </div>
              <button
                type="button"
                onClick={() => setShowDraftQueueModal(false)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              {activeDraftQueue.length === 0 ? (
                <div className="p-4 rounded-lg border border-stone-200 bg-stone-50 text-xs text-stone-500">
                  {lang === 'ka' ? 'განსახილველი AI ვერსიები არ არის.' : 'No saved AI drafts are waiting for review.'}
                </div>
              ) : (
                activeDraftQueue.map(action => (
                  <div key={action.id} className="p-3 border border-stone-200 bg-[#FCFAF9] rounded-lg space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[9px] uppercase tracking-wider font-mono font-black text-[#4e0e15]">
                        {draftActionLabel(action.type, lang)}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[8.5px] uppercase font-black font-mono ${
                        action.priority === 'high'
                          ? 'bg-rose-100 text-rose-700'
                          : action.priority === 'medium'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {action.priority === 'high' ? (lang === 'ka' ? 'მაღალი' : 'high') : action.priority === 'medium' ? (lang === 'ka' ? 'საშუალო' : 'medium') : (lang === 'ka' ? 'დაბალი' : 'low')}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-[#231f1d] leading-snug">{action.title}</h4>
                    <p className="text-[10.5px] leading-relaxed text-stone-550">{action.description}</p>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => onUpdateDraftStatus?.(action.id, 'dismissed')}
                        disabled={!onUpdateDraftStatus}
                        className="px-2.5 py-1 border border-stone-200 hover:bg-white text-stone-600 text-[10px] font-bold rounded cursor-pointer disabled:opacity-50"
                      >
                        {lang === 'ka' ? 'უარყოფა' : 'Dismiss'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCreateQueuedTask(action)}
                        disabled={!onAddNewTask}
                        className="px-2.5 py-1 bg-[#4e0e15] hover:bg-[#801323] text-white text-[10px] font-bold rounded cursor-pointer disabled:opacity-50"
                      >
                        {lang === 'ka' ? 'დავალების შექმნა' : 'Create Task'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
