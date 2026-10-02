import {
  Ban,
  BookOpenCheck,
  Check,
  Eye,
  FileSignature,
  Filter,
  Inbox,
  Layers,
  Link2,
  ListChecks,
  Pin,
  Plus,
  Printer,
  Send,
  Sparkles,
  Tags,
  UserRound,
  Wand2,
} from 'lucide-react';
import type { HelpStep } from '../help/HelpCallout';

/** "How this works" copy for the library, portfolio, resume and review screens. */
export const SHOWCASE_HELP: Record<string, { id: string; title: string; steps: HelpStep[] }> = {
  library: {
    id: 'showcase-library',
    title: 'Enter your work once',
    steps: [
      { icon: Plus, title: 'Add each piece once', text: 'A track, video, credit or show. Upload it or paste a link.' },
      {
        icon: Tags,
        title: 'Tag what you did',
        text: 'Your role, the genre and the instrument. Tags decide where it shows up.',
      },
      {
        icon: Layers,
        title: 'It joins your portfolios',
        text: 'Every portfolio whose rules match picks it up. Near misses wait for your review.',
      },
    ],
  },
  portfolios: {
    id: 'showcase-portfolios',
    title: 'Portfolios are views of your work',
    steps: [
      {
        icon: Filter,
        title: 'Rules choose the work',
        text: 'For example “where I’m the guitarist, in jazz or blues”.',
      },
      {
        icon: UserRound,
        title: 'Details come from your profile',
        text: 'Headline, bio and rates stay in sync unless you override them.',
      },
      {
        icon: Link2,
        title: 'Share or apply with it',
        text: 'Send the public link, or pick it when you apply for work.',
      },
    ],
  },
  portfolioEditor: {
    id: 'showcase-portfolio-editor',
    title: 'How this portfolio stays up to date',
    steps: [
      { icon: Filter, title: 'Rules pick the work', text: 'New work that matches joins on its own.' },
      {
        icon: Pin,
        title: 'Pin or exclude exceptions',
        text: 'Pin keeps an item in; exclude keeps it out. “Back to automatic” undoes either.',
      },
      { icon: Eye, title: 'Check the preview', text: 'The preview shows exactly what a visitor or hirer will see.' },
    ],
  },
  newPortfolio: {
    id: 'showcase-new-portfolio',
    title: 'Start from everything, remove what doesn’t fit',
    steps: [
      { icon: Wand2, title: 'Describe the goal', text: 'For example “film scoring reel for OTT” or “jazz sessions”.' },
      { icon: ListChecks, title: 'Review the picks', text: 'We keep what matches and explain every decision.' },
      { icon: Ban, title: 'Remove the misfits', text: 'Untick anything that doesn’t belong, then save.' },
    ],
  },
  career: {
    id: 'showcase-career',
    title: 'Your career record, entered once',
    steps: [
      {
        icon: BookOpenCheck,
        title: 'List everything',
        text: 'Experience, credits, education, skills, gear, languages, links and awards.',
      },
      {
        icon: FileSignature,
        title: 'Resumes pick from it',
        text: 'Each resume shows the sections and entries that fit one kind of work.',
      },
      { icon: Printer, title: 'Print or apply', text: 'Print any resume to PDF, or attach it when you apply.' },
    ],
  },
  resumes: {
    id: 'showcase-resumes',
    title: 'Resumes are views of your career record',
    steps: [
      { icon: Filter, title: 'Choose sections', text: 'Order them and keep only what this kind of work needs.' },
      { icon: Pin, title: 'Pin or exclude entries', text: 'Exceptions stay put when you add new entries.' },
      { icon: Printer, title: 'Print to PDF', text: 'The print view is laid out for paper and PDF.' },
    ],
  },
  review: {
    id: 'showcase-review',
    title: 'Changes we suggest, you decide',
    steps: [
      {
        icon: Sparkles,
        title: 'We spot near misses',
        text: 'New work that almost matches a portfolio, or text that mentions a tag.',
      },
      {
        icon: Check,
        title: 'Accept or reject',
        text: 'Accepting pins the item or adds the tags. Rejected ideas never come back.',
      },
      { icon: Inbox, title: 'Or accept them all', text: 'Clear the list in one go when everything looks right.' },
    ],
  },
  apply: {
    id: 'showcase-apply',
    title: 'Applying',
    steps: [
      { icon: Layers, title: 'Pick a portfolio and resume', text: 'Your defaults are chosen for you.' },
      { icon: Send, title: 'Send', text: 'The hirer gets a frozen copy of what you picked.' },
      { icon: Eye, title: 'Edit freely afterwards', text: 'Later changes never alter what they saw.' },
    ],
  },
};
