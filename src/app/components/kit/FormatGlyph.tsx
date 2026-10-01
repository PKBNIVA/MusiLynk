import { BookOpen, Briefcase, Bus, Disc3, GraduationCap, Mic2, Music, Users, type LucideIcon } from 'lucide-react';

const GLYPHS: Record<string, LucideIcon> = {
  gig: Music,
  session: Disc3,
  audition: Mic2,
  tour: Bus,
  teaching: GraduationCap,
  collaboration: Users,
  internship: BookOpen,
  job: Briefcase,
};

/** Icon for an opportunity_kind. Decorative: the kind is always written somewhere nearby. */
export function FormatGlyph({
  kind,
  size = 20,
  className = '',
}: {
  kind?: string | null;
  size?: 16 | 20 | 24;
  className?: string;
}) {
  const Icon = GLYPHS[(kind || 'job').toLowerCase()] || Briefcase;
  return (
    <Icon
      aria-hidden="true"
      size={size}
      className={`shrink-0 text-slate-300 ${className}`}
      data-glyph={kind || 'job'}
    />
  );
}
