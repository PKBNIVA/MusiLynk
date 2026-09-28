import {
  BadgeCheck,
  CalendarCheck,
  ClipboardList,
  Headphones,
  Link2,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

type Step = [LucideIcon, string, string];

const HIRER_STEPS: Step[] = [
  [
    ClipboardList,
    'Say who you need',
    'The role, date, area and budget. A session bassist for Friday, a dholi for a sangeet, a sound engineer for a show.',
  ],
  [
    Headphones,
    'Hear verified players',
    'Every profile leads with real work: YouTube, SoundCloud, Spotify or Instagram. Check the Verified badge before you message.',
  ],
  [
    ShieldCheck,
    'Book and pay the deposit',
    'Agree the fee and terms, pay the deposit through Razorpay, and review each other after the gig.',
  ],
];

const MUSICIAN_STEPS: Step[] = [
  [
    Link2,
    'Paste links to your work',
    'Your YouTube, Instagram, SoundCloud or Spotify links become a portfolio in about two minutes.',
  ],
  [
    BadgeCheck,
    'Get your Verified badge',
    'Our team reviews your work and profile. Hirers can filter for verified people, so it gets you seen.',
  ],
  [
    CalendarCheck,
    'Get booked',
    'Answer urgent requests and gig posts in your city: sessions, weddings, tours, jingles and OTT scores.',
  ],
];

/** Three steps for each side, switched with a tab so the page stays short. */
export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 px-4 py-16 sm:px-6 md:py-24">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-bold uppercase tracking-[.22em] text-teal-300">How it works</p>
        <h2 id="how-title" className="mt-3 max-w-2xl text-3xl font-black tracking-tight md:text-5xl">
          Three steps, whichever side you're on.
        </h2>
        <Tabs defaultValue="hiring" className="mt-8">
          <TabsList aria-label="Choose your side" className="w-full sm:w-fit">
            <TabsTrigger value="hiring" className="px-5">
              I'm hiring
            </TabsTrigger>
            <TabsTrigger value="musician" className="px-5">
              I'm a musician or crew
            </TabsTrigger>
          </TabsList>
          <TabsContent value="hiring" className="mt-6">
            <Steps steps={HIRER_STEPS} />
          </TabsContent>
          <TabsContent value="musician" className="mt-6">
            <Steps steps={MUSICIAN_STEPS} />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-4 md:grid-cols-3">
      {steps.map(([Icon, title, text], index) => (
        <li key={title} className="verse-surface rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-violet-500/15 text-violet-200">
              <Icon aria-hidden="true" size={21} />
            </span>
            <span className="text-sm font-semibold text-slate-400">Step {index + 1}</span>
          </div>
          <h3 className="mt-4 text-xl font-bold">{title}</h3>
          <p className="mt-2 leading-7 text-slate-300">{text}</p>
        </li>
      ))}
    </ol>
  );
}
