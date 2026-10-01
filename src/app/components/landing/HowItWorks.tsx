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
import { Photo } from '../media/Photo';
import { editorialPhoto } from './photos';

type Step = [LucideIcon, string];

// Three icons and at most eight words each.
const HIRER_STEPS: Step[] = [
  [ClipboardList, 'Say who you need'],
  [Headphones, 'Hear verified players'],
  [ShieldCheck, 'Book the one you like'],
];

const MUSICIAN_STEPS: Step[] = [
  [Link2, 'Paste links to your work'],
  [BadgeCheck, 'Get your Verified badge'],
  [CalendarCheck, 'Get booked'],
];

const STRIP = ['rehearsal-room', 'sitar-trio', 'studio-vocalist'] as const;

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
        <PhotoStrip />
      </div>
    </section>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-4 md:grid-cols-3">
      {steps.map(([Icon, title], index) => (
        <li key={title} className="verse-surface flex items-center gap-4 rounded-2xl p-5">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-200">
            <Icon aria-hidden="true" size={22} />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-400">Step {index + 1}</p>
            <h3 className="text-lg font-bold leading-6">{title}</h3>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Three photographs of musicians at work under the steps. */
function PhotoStrip() {
  return (
    <ul className="mt-6 grid grid-cols-3 gap-3" data-testid="how-photos">
      {STRIP.map((file) => {
        const photo = editorialPhoto(file);
        return (
          <li key={file} className="overflow-hidden rounded-2xl border border-white/10">
            <Photo
              src={photo.src}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              sizes="(min-width: 1152px) 368px, 33vw"
              className="aspect-[4/3] w-full object-cover sm:aspect-[3/2]"
            />
          </li>
        );
      })}
    </ul>
  );
}
