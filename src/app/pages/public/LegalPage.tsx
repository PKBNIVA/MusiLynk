import { useEffect, useState } from 'react';
import { usePageMeta } from '../../components/PageMeta';
import { Link, useLocation } from 'react-router';
import { PublicNav } from '../../components/PublicNav';
import { PhotoHeader } from '../../components/landing/PhotoHeader';
import { apiGet } from '../../lib/api';

// GET /api/legal/policy (LegalController#policy) — the DPDP grievance officer placeholders
// (config/legal.yml) and the booking fee/cancellation rules in plain words (config/bookings.yml,
// via BookingFeePolicy), read live so these sections never drift from the code that enforces
// them. A fetch failure just means the DPDP/booking sections below are skipped; the rest of the
// page (this file's static `sections`) is unaffected.
type LegalPolicy = {
  legal: {
    legalName: string;
    gstin: string;
    gstinPresent: boolean;
    businessAddress: string;
    businessState: string;
    grievanceOfficer: { name: string; email: string; address: string };
    /** Per field: false while config/legal.yml still holds a "[PLACEHOLDER]" (served blank). */
    configured?: {
      legalName: boolean;
      businessAddress: boolean;
      businessState: boolean;
      grievanceOfficer: { name: boolean; email: boolean; address: boolean };
    };
  };
  booking: { feeEnabled: boolean; plainEnglish: string[]; policyVersion: number };
};

function useLegalPolicy() {
  const [policy, setPolicy] = useState<LegalPolicy | null>(null);
  useEffect(() => {
    apiGet<LegalPolicy>('/legal/policy')
      .then(setPolicy)
      .catch(() => setPolicy(null));
  }, []);
  return policy;
}

const SUPPORT_EMAIL = 'admin@alienbrains.in';
const EFFECTIVE_DATE = '25 September 2026';

const sections: Record<string, { title: string; intro: string; items: [string, string][] }> = {
  about: {
    title: 'About Verse',
    intro:
      'Verse is an operating network for the music industry: careers, hiring, band building, talent discovery, live-act booking and music-production staffing.',
    items: [
      [
        'What Verse does',
        'Verse helps musicians show proof of work, discover opportunities, build teams, book talent and manage working relationships without forcing every use case into a generic job board.',
      ],
      [
        'Who it is for',
        'Performers, composers, producers, engineers, touring crews, managers, labels, studios, agencies, venues, festivals, production companies and other legitimate music-industry participants.',
      ],
      ['Operator', 'Verse is operated by Alien Brains Private Limited.'],
    ],
  },
  terms: {
    title: 'Terms of Use',
    intro:
      'These terms govern access to and use of Verse. By creating an account or using the service, you agree to follow them.',
    items: [
      [
        'Accounts and identity',
        'Provide accurate account information, keep credentials secure and do not impersonate another person, organization or act. You are responsible for activity performed through your account.',
      ],
      [
        'Opportunities and hiring',
        'Opportunities must describe legitimate work. Misleading jobs, unlawful discrimination, fake auditions, undisclosed application fees and fraudulent offers are prohibited.',
      ],
      [
        'Bookings and payments',
        'A booking is confirmed only when its status in Verse says so. Quotes, deposits, balances, cancellation terms and refund rules remain part of the booking record.',
      ],
      [
        'Content and rights',
        'Only upload or link work you have the right to share. You retain responsibility for your portfolio, credits, media and opportunity content.',
      ],
      [
        'Platform enforcement',
        'Verse may moderate, restrict, suspend or remove accounts or content that create safety, fraud, payment, abuse or legal risks.',
      ],
      ['Questions', `Questions about these terms can be sent to ${SUPPORT_EMAIL}.`],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    intro:
      'Verse processes account and marketplace information needed to provide profiles, hiring, booking, communication, billing, trust and safety functions.',
    items: [
      [
        'Data we process',
        'Account details; musician profile and portfolio data; applications; messages; availability; booking and billing records; verification and safety reports; and device, session and operational logs.',
      ],
      [
        'Why we use it',
        'To provide the service, authenticate users, match and search content, process transactions, prevent abuse, communicate service updates, improve reliability and meet legal obligations.',
      ],
      [
        'Public information',
        'Fields deliberately published on public profiles, acts and opportunities may be visible to search engines. Private contact details and internal hirer notes are not intended to be public.',
      ],
      [
        'Your data and your account',
        'Signed-in users can download a copy of their data and delete their account themselves from the account menu under “Your data & account”. Deleting an account removes the profile, portfolio, uploaded files, applications, saved jobs, alerts and reviews, and closes anything the user posted. Messages already sent stay with their recipients, shown as from “Deleted account”.',
      ],
      [
        'Retention and other requests',
        `Payment and invoice records are kept for as long as Indian tax and company law requires, even after an account is deleted. Other records are kept only while needed to operate Verse, resolve disputes and prevent abuse. To correct data, or for any request the account page does not cover, email ${SUPPORT_EMAIL}.`,
      ],
      [
        'Service providers',
        'Hosting, email, storage, analytics and payment providers may process limited data for Verse under their own security and contractual controls.',
      ],
    ],
  },
  safety: {
    title: 'Trust & Safety',
    intro:
      'Music work often moves quickly and informally. Verse is designed to make important terms more explicit and reportable.',
    items: [
      [
        'Avoid application fees',
        'Do not pay private “registration”, audition or security fees to obtain ordinary work. Report suspicious payment requests.',
      ],
      [
        'Keep commercial terms recorded',
        'For paid bookings or work, keep scope, date, amount, cancellation and payment records tied to the platform workflow where possible.',
      ],
      [
        'Verification is a signal',
        'Verification can reduce uncertainty but is not a guarantee of conduct, quality or financial performance.',
      ],
      [
        'Report problems',
        `Report impersonation, harassment, unsafe requests, fraud, rights infringement, payment diversion, discriminatory content or suspicious opportunities to ${SUPPORT_EMAIL}.`,
      ],
    ],
  },
  cookies: {
    title: 'Browser Storage & Session Notice',
    intro: 'Verse uses essential browser storage to authenticate accounts and remember product preferences.',
    items: [
      [
        'Authenticated sessions',
        'After sign-in, Verse stores an access credential in your browser’s local storage and sends it to the Verse API over HTTPS, so you stay signed in across tabs and browser restarts until the session expires (at most 30 days). Signing out removes it from every open Verse tab.',
      ],
      [
        'Local preferences',
        'Non-sensitive preferences, such as whether you completed the product tour, may be stored locally in your browser.',
      ],
      [
        'Optional analytics',
        'Verse will disclose and, where required, request consent before enabling non-essential analytics or advertising storage.',
      ],
    ],
  },
  refunds: {
    title: 'Payments, Cancellations & Refunds',
    intro: 'SaaS subscriptions and marketplace bookings are separate products with separate commercial terms.',
    items: [
      [
        'Subscriptions',
        'Plan changes, trial eligibility, renewal and cancellation follow the terms shown at purchase. Available billing controls and the effective date of a change are shown in the billing workspace.',
      ],
      [
        'Bookings',
        'Artist and act bookings may use quote-specific deposits, balance dates and cancellation terms. Refund eligibility depends on the accepted booking terms, booking status, timing and applicable law.',
      ],
      [
        'Disputes',
        `Verse does not promise escrow or guaranteed refunds unless that protection is explicitly shown during checkout. For a payment or cancellation issue, contact ${SUPPORT_EMAIL} with the relevant booking or transaction reference.`,
      ],
    ],
  },
  community: {
    title: 'Community conduct',
    intro: 'Verse is a marketplace. Treat other participants as collaborators and counterparties, not content targets.',
    items: [
      ['Respect', 'No harassment, threats, hate, sexual solicitation, spam or repeated unwanted contact.'],
      [
        'No harassment',
        'Harassment includes insults or slurs, sexual comments or requests, threats, pressure to meet alone or outside agreed work, messaging someone again after they said no or blocked you, and sharing anyone’s private details or images. One serious incident is enough for suspension.',
      ],
      [
        'No scams or fee requests',
        'Never ask talent to pay to be considered: no “registration”, audition, portfolio, joining or security fees and no “advance” from the person being hired. Do not share UPI IDs or bank details to collect such money, and do not push people to WhatsApp or Telegram before terms are agreed. Verse flags these patterns in messages and moderators act on reports.',
      ],
      [
        'Be honest',
        'Do not fabricate credits, availability, rates, client names, verification evidence or completed work.',
      ],
      [
        'No manipulation',
        'Do not create fake reviews, fake applications, fake bookings or multiple accounts to manipulate reputation or search.',
      ],
      [
        'Reporting and enforcement',
        'Use Report on a conversation, profile or opportunity. Moderators review the report with the relevant messages and the account’s history, then dismiss it, send a warning or suspend the account. Blocking stops messages both ways at any time.',
      ],
    ],
  },
  accessibility: {
    title: 'Accessibility',
    intro:
      'Verse aims to make core hiring, booking and profile workflows usable with keyboards, different screen sizes and assistive technologies.',
    items: [
      [
        'Product approach',
        'Core actions use semantic controls, visible focus states, readable contrast, labels for form inputs and alternatives for non-text media.',
      ],
      [
        'Accessibility support',
        `If you encounter an accessibility barrier, email ${SUPPORT_EMAIL}. Describe the screen and task, and Verse support will provide an alternate route where possible and record the issue for remediation.`,
      ],
    ],
  },
  contact: {
    title: 'Contact & Grievance Support',
    intro: 'Contact Verse for account, booking, billing, safety, privacy and accessibility support.',
    items: [
      ['Operator', 'Verse is operated by Alien Brains Private Limited.'],
      [
        'Support and grievances',
        `Email ${SUPPORT_EMAIL}. Include your account email and any relevant opportunity, booking or transaction reference, but never send a password, one-time code or full payment-card details.`,
      ],
      [
        'Response and escalation',
        'Verse will acknowledge the request and route it to the appropriate account, safety, privacy or billing owner. Urgent safety reports should be clearly marked “Urgent safety” in the subject line.',
      ],
    ],
  },
};

/** The grievance officer's details once they are filled in; until then a neutral line, so the
 * page never prints "[NAME]" or an empty "Email:". */
function grievanceOfficerItem(legal: LegalPolicy['legal']): [string, string] {
  const title = 'Grievance Officer (DPDP Act, 2023) — Draft, pending legal review';
  const flags = legal.configured?.grievanceOfficer;
  const officer = legal.grievanceOfficer;
  if (!flags?.name || !flags.email) {
    return [
      title,
      `Contact details are published before launch. Until then, write to ${SUPPORT_EMAIL} and mark the subject “Data protection”.`,
    ];
  }
  const details = [`Name: ${officer.name}`, `Email: ${officer.email}`];
  if (flags.address) details.push(`Address: ${officer.address}`);
  return [
    title,
    `${details.join(' · ')}. Contact the Grievance Officer for a data protection complaint under the DPDP Act; other support requests go to ${SUPPORT_EMAIL}.`,
  ];
}

/** DPDP grievance officer + booking policy sections, appended to Privacy/Terms only once the
 * live policy has loaded. Both are clearly marked as drafts: this is config rendered as prose,
 * not legal advice, and a lawyer/CA still needs to sign off on the wording (see
 * backend/docs/compliance-checklist.md). */
function dynamicItems(key: string, policy: LegalPolicy | null): [string, string][] {
  // The page must never crash on a missing or partial policy (API down, or an old/odd response):
  // it just shows the static text without the generated sections.
  if (!policy?.legal?.grievanceOfficer || !Array.isArray(policy.booking?.plainEnglish)) return [];
  if (key === 'privacy') {
    return [
      [
        'Data Protection (DPDP Act, 2023) — Draft, pending legal review',
        'What we collect: account and contact details, musician profile and portfolio data, booking and payment records, and device/session logs. Purpose: to provide the service, process bookings and payments, prevent abuse and meet legal obligations. Consent: creating an account and using booking/payment features is your consent to this processing for those purposes; where a feature asks for separate consent (e.g. optional analytics), it is requested there. Withdrawal: you can withdraw consent for optional processing at any time from account settings, and delete your account entirely (see "Your data and your account" above) — Verse then deletes what the law allows it to delete and keeps only what tax and company law requires.',
      ],
      grievanceOfficerItem(policy.legal),
    ];
  }
  if (key === 'terms' && policy.booking.plainEnglish.length) {
    return [
      [
        'Booking fee, cancellation & no-shows — Draft, pending legal review',
        `${policy.booking.plainEnglish.join(' ')} (Policy version ${policy.booking.policyVersion}.) These rules are generated from Verse's live configuration, so they always match what the booking flow actually charges and refunds.`,
      ],
    ];
  }
  return [];
}

/** The photograph behind each page's header (public/img, credited on /credits). */
const PHOTOS: Record<string, string> = {
  about: 'wedding-band',
  safety: 'choir-stage',
  community: 'choir-stage',
  contact: 'studio-vocalist',
};

const anchorId = (title: string) =>
  `s-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

const RELATED: [label: string, to: string][] = [
  ['Terms', '/terms'],
  ['Privacy', '/privacy'],
  ['Safety', '/safety'],
  ['Browser storage', '/cookies'],
  ['Refunds', '/refund-policy'],
  ['Conduct', '/community-guidelines'],
  ['Accessibility', '/accessibility'],
  ['Contact', '/contact'],
];

export default function LegalPage() {
  const path = useLocation().pathname.split('/').filter(Boolean)[0] || 'about';
  const key = path === 'community-guidelines' ? 'community' : path === 'refund-policy' ? 'refunds' : path;
  const content = sections[key] || sections.about;
  const policy = useLegalPolicy();
  const items = [...content.items, ...dynamicItems(key, policy)];
  usePageMeta(content.title, content.intro, { canonicalPath: `/${path}` });
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="max-w-5xl mx-auto px-5 py-10 md:py-14">
        <PhotoHeader photo={PHOTOS[key] ?? 'sarod-mumbai'} eyebrow="Verse information" title={content.title}>
          <p className="text-lg leading-8">{content.intro}</p>
        </PhotoHeader>
        <div className="mt-9 lg:grid lg:grid-cols-[13rem_1fr] lg:gap-10">
          {items.length > 3 && (
            <nav aria-label="On this page" className="hidden lg:block">
              <ul className="sticky top-24 space-y-2 text-sm" data-testid="legal-contents">
                {items.map(([title]) => (
                  <li key={title}>
                    <a href={`#${anchorId(title)}`} className="text-slate-400 hover:text-white">
                      {title.replace(/ — Draft, pending legal review$/, '')}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <div className={`space-y-4 ${items.length > 3 ? '' : 'lg:col-span-2'}`}>
            {items.map(([title, body]) => (
              <section
                key={title}
                id={anchorId(title)}
                className="scroll-mt-24 rounded-xl border border-white/10 bg-white/[.035] p-5"
              >
                <h2 className="font-semibold text-lg">{title}</h2>
                <p className="text-slate-300 leading-7 mt-2">{body}</p>
                {body.includes(SUPPORT_EMAIL) && (
                  <a
                    className="inline-block mt-3 text-violet-300 hover:text-violet-200 underline underline-offset-4"
                    href={`mailto:${SUPPORT_EMAIL}`}
                  >
                    Email Verse support
                  </a>
                )}
              </section>
            ))}
            {['terms', 'privacy', 'cookies', 'refunds'].includes(key) && (
              <p className="text-xs text-slate-400 pt-3">
                Effective {EFFECTIVE_DATE}. Material updates will be published on this page.
              </p>
            )}
          </div>
        </div>
        <nav aria-label="Related pages" className="mt-10 flex flex-wrap gap-2 text-sm">
          {RELATED.filter(([, to]) => to !== `/${path}`).map(([label, to]) => (
            <Link
              key={to}
              to={to}
              className="rounded-full border border-white/10 px-3.5 py-1.5 text-slate-300 hover:border-white/30 hover:text-white"
            >
              {label}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
