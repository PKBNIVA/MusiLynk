import { LayoutTemplate } from 'lucide-react';
import { Button } from '../ui/button';

/**
 * Six ready-made opportunity templates, by the kind of work — a template instead of an AI call
 * for the common shapes of a listing. No network, no AI: just a title, a description skeleton
 * (with [bracketed] spots to fill in) and three screening questions, ready to edit.
 */
export interface JobPostTemplate {
  id: string;
  /** Shown on the template's button. */
  label: string;
  /** PostJob's `opportunityKind` value this template best matches. */
  opportunityKind: string;
  title: string;
  description: string;
  screeningQuestions: [string, string, string];
}

export const JOB_POST_TEMPLATES: JobPostTemplate[] = [
  {
    id: 'studio-session',
    label: 'Studio session',
    opportunityKind: 'session',
    title: 'Session musician for a studio recording',
    description:
      'We are recording [project/album name] at [studio name] and need a session player for [instrument/role]. ' +
      'Session covers [number] tracks over [number] session(s), reading from [charts/reference tracks]. ' +
      'Please bring your own [instrument/gear], arrive [call time] before the session and be ready to record straight away.',
    screeningQuestions: [
      'Can you read charts and/or take direction from reference tracks?',
      'What gear will you bring to the session?',
      'Are you available on [date] for the full session length?',
    ],
  },
  {
    id: 'wedding-event',
    label: 'Wedding / event gig',
    opportunityKind: 'gig',
    title: 'Performer for a wedding / private event',
    description:
      'Looking for [solo artist/band/DJ] for a [wedding/private event] on [date] at [venue, city]. ' +
      'Set runs [start time] to [end time], covering [genre/style] the crowd will enjoy. ' +
      'PA and basic stage setup [will/will not] be provided — please confirm what you bring.',
    screeningQuestions: [
      'Are you available on [date] for the full event window?',
      'What genres/styles do you usually cover for weddings and events?',
      'Do you bring your own sound system, or do you need one provided?',
    ],
  },
  {
    id: 'tour',
    label: 'Tour',
    opportunityKind: 'tour',
    title: 'Touring musician for an upcoming run of shows',
    description:
      '[Artist/band name] is touring [region/cities] from [start date] to [end date] and needs a [instrument/role] for the run. ' +
      'Expect [number] shows, travel by [mode of travel], with rehearsals starting [rehearsal date]. ' +
      'Per diem and travel [are/are not] covered — details on request.',
    screeningQuestions: [
      'Are you free for the entire tour window, including travel days?',
      'Have you toured before, and for how long at a stretch?',
      'Do you have a valid passport / travel documents if this tour crosses borders?',
    ],
  },
  {
    id: 'jingle-ad',
    label: 'Jingle / ad',
    opportunityKind: 'job',
    title: 'Composer/performer for a jingle or ad spot',
    description:
      '[Brand/agency name] needs a [composer/vocalist/musician] for a [length]-second jingle or ad spot for [product/campaign]. ' +
      'Brief and reference tracks will be shared on shortlisting; turnaround is [number] day(s) from brief to first draft. ' +
      'Usage is [region/media] for [duration] — full rights details shared before you accept.',
    screeningQuestions: [
      'Can you turn around a first draft within the stated timeline?',
      'Have you scored or performed on ad/jingle work before? Share an example if you can.',
      'Are you comfortable with the usage terms (region, media, duration) described above?',
    ],
  },
  {
    id: 'ott-film-score',
    label: 'OTT / film score',
    opportunityKind: 'job',
    title: 'Composer/musician for an OTT or film score',
    description:
      '[Production house/director name] is scoring [film/series title], a [genre] [film/series] releasing on [platform/date]. ' +
      'Looking for a [composer/orchestrator/session player] to work on [number] cue(s) / the [portion] of the score. ' +
      'Reference tone: [mood/reference tracks]. Delivery format and deadline shared after shortlisting.',
    screeningQuestions: [
      'Can you share past score work or a reel relevant to this genre/mood?',
      'What is your usual turnaround for a scored cue, from brief to delivery?',
      'Are you set up to deliver stems/final mixes in the format we need?',
    ],
  },
  {
    id: 'teaching',
    label: 'Teaching',
    opportunityKind: 'job',
    title: 'Music teacher / instructor',
    description:
      '[School/studio name] in [city] is looking for a [instrument/subject] teacher for [beginner/intermediate/advanced] students. ' +
      'Classes run [days/times], [number] student(s) per batch, [online/in-person] at [location]. ' +
      'Curriculum and lesson materials [are/are not] provided.',
    screeningQuestions: [
      'How many years of teaching experience do you have, and at what levels?',
      'Are you available for the stated days/times on an ongoing basis?',
      'Do you have a teaching approach or curriculum you usually follow?',
    ],
  },
];

export interface JobPostTemplatesProps {
  onApply: (template: JobPostTemplate) => void;
  className?: string;
}

/** "Start from a template" — six buttons, one per opportunity type. Picking one hands the whole
 * template to `onApply`; PostJob decides how to merge it into the form. */
export function JobPostTemplates({ onApply, className }: JobPostTemplatesProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 text-sm font-medium text-slate-200 mb-2">
        <LayoutTemplate aria-hidden="true" size={15} className="text-violet-300" />
        Start from a template
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Opportunity templates">
        {JOB_POST_TEMPLATES.map((template) => (
          <Button key={template.id} type="button" variant="outline" size="sm" onClick={() => onApply(template)}>
            {template.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
