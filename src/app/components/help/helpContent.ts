import {
  BadgeCheck,
  Bell,
  Bookmark,
  CalendarCheck,
  CalendarPlus,
  CalendarRange,
  ClipboardList,
  Eye,
  FileAudio,
  Filter,
  Handshake,
  Inbox,
  ListChecks,
  MessageSquare,
  Mic2,
  PenLine,
  Search,
  Send,
  ShieldCheck,
  Share2,
  Sparkles,
  Star,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import type { HelpStep } from './HelpCallout';

/** "How this works" copy for each workspace page, kept in one place so the voice stays consistent. */
export const HELP: Record<string, { id: string; title: string; steps: HelpStep[] }> = {
  jobseekerDashboard: {
    id: 'jobseeker-dashboard',
    title: 'How MusiLynk works for you',
    steps: [
      {
        icon: UserRound,
        title: 'Build your profile',
        text: 'Add credits, genres and a showreel so hirers can hear what you do.',
      },
      { icon: Send, title: 'Apply or get booked', text: 'Apply to gigs and sessions, or let bookers find your act.' },
      { icon: ListChecks, title: 'Track everything', text: 'Applications, messages and bookings all update here.' },
    ],
  },
  employerDashboard: {
    id: 'employer-dashboard',
    title: 'How hiring works',
    steps: [
      {
        icon: PenLine,
        title: 'Post an opportunity',
        text: 'Three short steps. Clear pay and dates get better applicants.',
      },
      {
        icon: ClipboardList,
        title: 'Review applicants',
        text: 'Hear samples, read answers and shortlist in one place.',
      },
      { icon: Handshake, title: 'Hire or book', text: 'Message, schedule an interview, or send a booking quote.' },
    ],
  },
  jobs: {
    id: 'job-search',
    title: 'Finding the right work',
    steps: [
      {
        icon: Filter,
        title: 'Search and filter',
        text: 'Narrow by format, function and workplace. Filters apply instantly.',
      },
      {
        icon: Bookmark,
        title: 'Save and get alerts',
        text: 'Save opportunities, or turn a search into an email alert.',
      },
      { icon: FileAudio, title: 'Apply with proof', text: 'Your profile and work samples go with every application.' },
    ],
  },
  applications: {
    id: 'applications',
    title: 'How applications work',
    steps: [
      { icon: Send, title: 'You apply', text: 'Your answers, profile and samples go to the hirer together.' },
      { icon: Eye, title: 'They review', text: 'The status here changes as they shortlist or schedule an interview.' },
      {
        icon: MessageSquare,
        title: 'You hear back',
        text: 'Replies arrive in Messages, and we notify you by email too.',
      },
    ],
  },
  employerApplications: {
    id: 'employer-applications',
    title: 'Reviewing applicants',
    steps: [
      {
        icon: Filter,
        title: 'Pick an opportunity',
        text: 'Filter the list to one opportunity to compare like for like.',
      },
      { icon: Star, title: 'Rate and note', text: 'Private ratings and notes are only visible to your team.' },
      {
        icon: CalendarCheck,
        title: 'Move them forward',
        text: 'Shortlist, schedule an interview or message in one click.',
      },
    ],
  },
  bookTalent: {
    id: 'book-talent',
    title: 'How booking works',
    steps: [
      { icon: Search, title: 'Find an act', text: 'Search by city and act type, then open a profile to hear them.' },
      { icon: Send, title: 'Send an enquiry', text: 'Share the date, city and budget. The act replies with a quote.' },
      { icon: Wallet, title: 'Confirm the booking', text: 'Accept the quote and pay the deposit to lock the date.' },
    ],
  },
  acts: {
    id: 'acts',
    title: 'How acts work',
    steps: [
      { icon: Mic2, title: 'Create the act', text: 'A solo, duo, band or ensemble with its own name and fees.' },
      { icon: Users, title: 'Add the lineup', text: 'Name each member so bookers know who turns up.' },
      { icon: Inbox, title: 'Get enquiries', text: 'Published acts appear in Book music and receive quotes requests.' },
    ],
  },
  portfolio: {
    id: 'portfolio',
    title: 'Why work samples matter',
    steps: [
      { icon: FileAudio, title: 'Add your best work', text: 'Three strong tracks or videos beat twenty average ones.' },
      { icon: BadgeCheck, title: 'Say what you did', text: 'Your role on each piece is what hirers actually check.' },
      {
        icon: Share2,
        title: 'It travels with you',
        text: 'Public samples show on your profile and every application.',
      },
    ],
  },
  messages: {
    id: 'messages',
    title: 'Messaging on MusiLynk',
    steps: [
      {
        icon: MessageSquare,
        title: 'Talk about the work',
        text: 'Each conversation is linked to a job, booking or act.',
      },
      {
        icon: ShieldCheck,
        title: 'Keep it here',
        text: 'Never pay fees to move off-platform. Staying here keeps you protected.',
      },
      { icon: Bell, title: 'Report anything odd', text: 'Use Report in a conversation and our team will take a look.' },
    ],
  },
  stage: {
    id: 'stage',
    title: 'What is the Stage',
    steps: [
      {
        icon: Sparkles,
        title: 'Share your work',
        text: 'Post updates, performances, releases and gigs, as yourself or as a Page you run.',
      },
      {
        icon: Handshake,
        title: 'Applause, comment, reshare',
        text: 'React to what you see, and follow people or Pages to see more of their posts.',
      },
      {
        icon: Search,
        title: 'Genres, cities and jobs',
        text: 'Hashtags for genres and cities help people find you; job and gig shares have a live apply button.',
      },
    ],
  },
  availability: {
    id: 'availability',
    title: 'How availability works',
    steps: [
      { icon: CalendarPlus, title: 'Add your dates', text: 'Mark when you are free, pencilled in, or already booked.' },
      { icon: CalendarRange, title: 'Keep it current', text: 'Up-to-date calendars get more enquiries from bookers.' },
      {
        icon: Eye,
        title: 'Bookers check it',
        text: 'They see free and busy dates, never the details of your bookings.',
      },
    ],
  },
};
