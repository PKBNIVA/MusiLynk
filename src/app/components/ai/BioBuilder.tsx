import { useMemo, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

/**
 * BioBuilder assembles a profile headline and bio entirely from the fields already on the
 * profile form — no network call, no AI. It exists so every talent account, not only the
 * lifetime-capped 5 free AI uses, gets a decent first draft to start from. The onboarding/landing
 * flow (ProfileSetup) mounts this itself; nothing here reaches out to the server.
 */

export interface BioBuilderInput {
  /** e.g. ["Session Guitarist", "Producer"]. */
  roles: string[];
  city?: string;
  /** Free text, e.g. "5" or "5+" — shown as given. */
  years?: string;
  genres?: string[];
  /** 1 to 3 short credits, e.g. "Toured with Indian Ocean". Extra entries are ignored. */
  credits?: string[];
}

export type BioTone = 'plain' | 'warm' | 'confident';

export interface BioBuilderVariant {
  tone: BioTone;
  /** Label shown on the tone's tab. */
  label: string;
  headline: string;
  bio: string;
}

const TONE_LABELS: Record<BioTone, string> = { plain: 'Straightforward', warm: 'Warm', confident: 'Confident' };

const list = (values: string[] | undefined, max: number) =>
  (values || [])
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);

const joinAnd = (values: string[]) =>
  values.length <= 1 ? values[0] || '' : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;

function roleLine(roles: string[]) {
  return roles.length ? joinAnd(roles) : 'musician';
}

/** Pure and deterministic: the same input always builds the same three variants. Exported so it
 * can be unit-tested, or reused, without rendering the picker UI. */
export function buildBioVariants(input: BioBuilderInput): BioBuilderVariant[] {
  const roles = list(input.roles, 4);
  const genres = list(input.genres, 4);
  const credits = list(input.credits, 3);
  const city = input.city?.trim();
  const years = input.years?.trim();
  const roleText = roleLine(roles);
  const genreText = genres.length ? joinAnd(genres) : '';
  const yearsText = years ? `${years.replace(/\+?$/, '')}+ years` : '';
  const creditText = credits.length ? joinAnd(credits) : '';

  const headlines: Record<BioTone, string> = {
    plain: [roleText, city && `in ${city}`].filter(Boolean).join(' '),
    warm: [genreText ? `${roleText} bringing ${genreText} to life` : roleText, city && `in ${city}`]
      .filter(Boolean)
      .join(' '),
    confident: [yearsText && `${yearsText} as a`, roleText, genreText && `across ${genreText}`]
      .filter(Boolean)
      .join(' '),
  };

  const bios: Record<BioTone, string> = {
    plain: sentences([
      `I'm a ${roleText}${city ? ` based in ${city}` : ''}.`,
      genreText && `I work across ${genreText}.`,
      yearsText && `${yearsText} of experience.`,
      creditText && `Credits include ${creditText}.`,
      "Open to new projects — message me about what you're working on.",
    ]),
    warm: sentences([
      `I'm a ${roleText}${city ? `, based in ${city}` : ''}, and I love bringing music to life${genreText ? ` in ${genreText}` : ''}.`,
      yearsText && `I've spent ${yearsText} doing what I love.`,
      creditText && `Some of the work I'm proudest of: ${creditText}.`,
      "I'd love to hear about your next project — let's talk.",
    ]),
    confident: sentences([
      `${yearsText ? `With ${yearsText} of experience, ` : ''}I'm a ${roleText}${genreText ? ` specializing in ${genreText}` : ''}${city ? `, working out of ${city}` : ''}.`,
      creditText && `My work includes ${creditText}.`,
      'I bring reliability, sharp musicianship and a fast turnaround to every session.',
    ]),
  };

  return (['plain', 'warm', 'confident'] as const).map((tone) => ({
    tone,
    label: TONE_LABELS[tone],
    headline: capitalize(headlines[tone]) || 'Musician',
    bio: bios[tone],
  }));
}

function sentences(parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

function capitalize(text: string) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export interface BioBuilderProps {
  input: BioBuilderInput;
  /** Called with the chosen variant's headline when the person clicks "Use this headline". */
  onAcceptHeadline?: (headline: string) => void;
  /** Called with the chosen variant's bio when the person clicks "Use this bio". */
  onAcceptBio?: (bio: string) => void;
  className?: string;
}

/** A tone picker over three no-network variants, each with its own "Use this" actions. */
export function BioBuilder({ input, onAcceptHeadline, onAcceptBio, className }: BioBuilderProps) {
  const variants = useMemo(() => buildBioVariants(input), [input]);
  const [tone, setTone] = useState<BioTone>('plain');
  const active = variants.find((v) => v.tone === tone) || variants[0];

  return (
    <Card className={`bg-white/[.04] border-white/10 ${className || ''}`} data-testid="bio-builder">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <Wand2 aria-hidden="true" size={15} className="text-violet-300" />
          Build from your details
        </div>
        <div role="tablist" aria-label="Tone" className="flex gap-1.5">
          {variants.map((v) => (
            <button
              key={v.tone}
              type="button"
              role="tab"
              aria-selected={v.tone === tone}
              onClick={() => setTone(v.tone)}
              className={`rounded-full px-3 py-1 text-xs border ${
                v.tone === tone
                  ? 'border-violet-400 bg-violet-500/20 text-violet-100'
                  : 'border-white/15 text-slate-400 hover:text-slate-200'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Headline</p>
          <p className="text-sm text-slate-100">{active.headline}</p>
          {onAcceptHeadline && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => onAcceptHeadline(active.headline)}
            >
              Use this headline
            </Button>
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Bio</p>
          <p className="text-sm text-slate-100 whitespace-pre-wrap">{active.bio}</p>
          {onAcceptBio && (
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => onAcceptBio(active.bio)}>
              Use this bio
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
