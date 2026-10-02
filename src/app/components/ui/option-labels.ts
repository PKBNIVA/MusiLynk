/**
 * Human labels for the raw values the API stores (e.g. "onsite" -> "On-site"). The submitted value
 * never changes; only what people read does.
 */
export interface OptionCopy {
  label: string;
  description?: string;
}

export const OPTION_COPY: Record<string, OptionCopy> = {
  // Opportunity kinds
  job: { label: 'Job', description: 'An ongoing or salaried role' },
  gig: { label: 'Gig', description: 'A one-off paid show or event' },
  audition: { label: 'Audition', description: 'Try-outs for a band, show or ensemble' },
  session: { label: 'Studio session', description: 'Recording, overdubs or production work' },
  tour: { label: 'Tour', description: 'Multi-date travel with an artist or show' },
  internship: { label: 'Internship', description: 'Learning-focused, usually for early-career people' },
  collaboration: { label: 'Collaboration', description: 'Co-writing or a shared creative project' },
  // Workplace
  onsite: { label: 'On-site', description: 'At a venue, studio or office' },
  remote: { label: 'Remote', description: 'Work from anywhere' },
  hybrid: { label: 'Hybrid', description: 'A mix of on-site and remote' },
  travel: { label: 'Travel', description: 'On the road, across cities' },
  // Skill levels
  developing: { label: 'Developing', description: 'Still building experience' },
  intermediate: { label: 'Intermediate', description: 'Comfortable with regular gigs' },
  professional: { label: 'Professional', description: 'Works in music full-time' },
  touring: { label: 'Touring', description: 'Proven on the road' },
  elite: { label: 'Elite', description: 'Top-tier, headline experience' },
  // Availability statuses
  available: { label: 'Available', description: 'Open for bookings' },
  hold: { label: 'On hold', description: 'Pencilled in, not confirmed' },
  tentative: { label: 'Tentative', description: 'Might be free, ask first' },
  booked: { label: 'Booked', description: 'Confirmed, not available' },
  unavailable: { label: 'Unavailable', description: 'Not taking work' },
  // Workspace roles
  owner: { label: 'Owner' },
  admin: { label: 'Admin', description: 'Can manage members and settings' },
  recruiter: { label: 'Recruiter', description: 'Posts opportunities and reviews applicants' },
  booker: { label: 'Booker', description: 'Sends enquiries and manages bookings' },
  finance: { label: 'Finance', description: 'Sees quotes, deposits and billing' },
  member: { label: 'Member', description: 'Can view shared work' },
  // Alert frequency
  daily: { label: 'Daily' },
  weekly: { label: 'Weekly' },
  saved: { label: 'Saved only' },
  // Visibility
  public: { label: 'Public', description: 'Anyone on MusiLynk can see it' },
  private: { label: 'Private', description: 'Only you can see it' },
  // Currencies
  INR: { label: '₹ · Indian rupee' },
  USD: { label: '$ · US dollar' },
  EUR: { label: '€ · Euro' },
  GBP: { label: '£ · British pound' },
  AED: { label: 'AED · UAE dirham' },
  SGD: { label: 'SGD · Singapore dollar' },
  AUD: { label: 'AUD · Australian dollar' },
  CAD: { label: 'CAD · Canadian dollar' },
};

/** "wedding-band" -> "Wedding band"; known values use OPTION_COPY. */
export function optionLabel(value: string | null | undefined): string {
  if (!value) return '';
  const known = OPTION_COPY[value];
  if (known) return known.label;
  const spaced = value.replace(/[-_]+/g, ' ').trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : value;
}

export function optionDescription(value: string): string | undefined {
  return OPTION_COPY[value]?.description;
}
