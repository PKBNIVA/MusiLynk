// Response shapes of the Rails API as the pages read them. Each type mirrors what the named
// controller or model method renders (see backend/app); many endpoints merge raw snake_case
// column attributes with camelCase extras, so both spellings appear where the API sends both.
// Ids are strings (every table uses string primary keys) and timestamps are ISO-8601 strings.

import type { Role } from './authContext';
import type { RazorpayCheckoutConfig } from './razorpayCheckout';

/** `{ ok: true }` acknowledgements. */
export interface Ok {
  ok: boolean;
}

// ---------------------------------------------------------------------------------------------
// People

/**
 * Profile#api_json: the profiles row with camelCase keys, merged into every user payload. Every
 * account gets a profile row at sign-up, and its list columns default to [].
 */
export interface ProfileFields {
  headline?: string | null;
  phone?: string | null;
  location?: string | null;
  experience?: string | null;
  website?: string | null;
  portfolioUrl?: string | null;
  bio?: string | null;
  skills: string[];
  genres: string[];
  instruments: string[];
  languages: string[];
  credits: string[];
  openTo: string[];
  roles: string[];
  gear: string[];
  software: string[];
  companyName?: string | null;
  companyWebsite?: string | null;
  companySize?: string | null;
  companyDescription?: string | null;
  verified?: boolean;
  travelsNationally?: boolean;
  travelsInternationally?: boolean;
  remoteRecording?: boolean;
  sightReading?: boolean;
  passportReady?: boolean;
  yearsExperience?: number | null;
  travelRadiusKm?: number | null;
  hourlyRate?: number | null;
  sessionRate?: number | null;
  showRate?: number | null;
  tourDayRate?: number | null;
  dayRate?: number | null;
  availability?: string | null;
  currency?: string | null;
}

/** ApplicationController#public_user: the signed-in user's own account plus profile (GET /me, PUT /profile). */
export interface AccountUser extends ProfileFields {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  profileComplete: boolean;
  emailVerified: boolean;
  last_login_at?: string | null;
}

/** ApplicationController#public_profile: a professional as other people see them. */
export interface Professional extends ProfileFields {
  id: string;
  name: string;
  role: Role;
  demo?: boolean;
  /** TalentController#index only: whether the viewing employer shortlisted them. */
  shortlisted?: boolean;
}

/** TalentController#compare: a professional with their public work and upcoming availability. */
export interface ComparedProfessional extends Omit<Professional, 'availability'> {
  portfolio?: PortfolioItem[];
  availability?: { startAt: string; endAt: string; status: string; city?: string | null }[];
}

/** RecentActivity rows, camelCased (GET /recent-activity). */
export interface RecentActivity {
  id: string;
  kind: string;
  query?: string | null;
  entityId?: string | null;
  label?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// Opportunities and applications

/** Job#api_json: listing columns (all columns for the owner and admins) plus camelCase extras. */
export interface Job {
  id: string;
  employer_id: string;
  title: string;
  company: string;
  location?: string | null;
  kind: string;
  genre?: string | null;
  salary?: string | null;
  description?: string | null;
  requirements?: string | null;
  skills: string[];
  languages: string[];
  screening_questions: string[];
  experience_level?: string | null;
  status: string;
  opportunity_kind?: string | null;
  function_area?: string | null;
  workplace?: string | null;
  currency?: string | null;
  compensation_period?: string | null;
  duration?: string | null;
  compensation_min?: number | null;
  compensation_max?: number | null;
  slots?: number | null;
  featured?: boolean;
  paid?: boolean;
  portfolio_required?: boolean;
  application_deadline?: string | null;
  start_date?: string | null;
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
  /** Owner and admin views only. */
  moderation_note?: string | null;
  type: string;
  portfolioRequired: boolean;
  screeningQuestions: string[];
  employerName: string;
  employerVerified: boolean;
  demo: boolean;
  applicationsCount: number;
  createdAt: string;
  updatedAt: string;
  /** JobsController#index/#show for the signed-in viewer. */
  saved?: boolean;
  applied?: boolean;
  /** DashboardController (job seeker): how well the job matches the viewer's profile. */
  fitScore?: number;
  /** Employer::JobsController#owner_json and the employer dashboard. */
  applications?: number;
  allowedNextStatuses?: string[];
  /** The Page (studio or band) the job was posted as; null for a personal post. */
  postedAs?: { type: 'organization' | 'act'; id: string; name: string } | null;
}

/** POST /jobs. */
export interface CreatedJob {
  id: string;
  status: string;
  moderationFlags: string[];
}

/** Application#api_json: the applications row plus camelCase fields and a job summary. */
export interface Application {
  id: string;
  job_id: string;
  candidate_id: string;
  status: string;
  cover_letter?: string | null;
  interview_date?: string | null;
  screening_answers: unknown[];
  created_at?: string;
  updated_at?: string;
  jobId: string;
  coverLetter?: string | null;
  interviewDate?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Stored as free-form JSON; the apply form sends strings. */
  screeningAnswers: unknown[];
  opportunityKind?: string | null;
  workplace?: string | null;
  title: string;
  company: string;
  location?: string | null;
}

/** Employer::ApplicationsController#index: an application with the hiring team's view of the candidate. */
export interface EmployerApplication extends Application {
  recruiter_rating?: number | null;
  recruiter_note?: string | null;
  recruiterRating?: number | null;
  recruiterNote?: string | null;
  jobTitle: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  headline?: string | null;
  candidateLocation?: string | null;
  experience?: string | null;
  skills: string[];
  genres: string[];
  verified: boolean;
  allowedNextStatuses: string[];
}

/** GET /dashboard for a job seeker. */
export interface JobSeekerDashboard {
  applications: number;
  interviews: number;
  saved: number;
  profileScore: number;
  recommendedJobs: Job[];
}

/** GET /dashboard for an employer. */
export interface EmployerDashboard {
  jobs: number;
  published: number;
  activeJobs: number;
  applications: number;
  shortlisted: number;
  recentJobs: Job[];
}

// ---------------------------------------------------------------------------------------------
// Portfolio and talent folders

/** What the portfolio editor records about an uploaded file (free-form JSON on the server). */
export interface MediaMetadata {
  contentType?: string;
  byteSize?: number;
  filename?: string;
  uploadId?: string;
  [key: string]: unknown;
}

/** PortfolioItem#api_json: the portfolio_items row camelCased, with `type` mirroring `kind`. */
export interface PortfolioItem {
  id: string;
  userId?: string;
  kind: string;
  type: string;
  title: string;
  url: string;
  creditedAs?: string | null;
  thumbnailUrl?: string | null;
  waveformUrl?: string | null;
  visibility?: string | null;
  description?: string | null;
  tags?: string[];
  genres?: string[];
  roles?: string[];
  instruments?: string[];
  mediaMetadata?: MediaMetadata | null;
  year?: number | null;
  sortOrder?: number | null;
  featured?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** TalentFoldersController#index: a folder row plus how many professionals it holds. */
export interface TalentFolder {
  id: string;
  owner_id?: string;
  name: string;
  description?: string | null;
  count?: number;
  created_at?: string;
  updated_at?: string;
}

/** POST endpoints that answer with just the new record's id. */
export interface Created {
  id: string;
}

// ---------------------------------------------------------------------------------------------
// Messaging

/** ConversationsController#serialize: one inbox row, from the viewer's side. */
export interface Conversation {
  id: string;
  candidateName?: string;
  employerName?: string;
  counterpartId?: string;
  counterpartName?: string;
  counterpartActive?: boolean;
  blockedByMe?: boolean;
  blockedMe?: boolean;
  viewerSide?: 'candidate' | 'employer';
  jobId?: string | null;
  jobTitle?: string | null;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  lastMessageFromMe?: boolean;
  unreadCount?: number;
  updatedAt?: string;
}

/**
 * MessagesController#serialize. safetyFlags are scam-pattern signals, only ever sent to the
 * recipient (see backend ScamSignals).
 */
export interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  readAt?: string | null;
  safetyFlags?: string[];
}

/**
 * GET /conversations/:id/messages: the newest page of a thread, the page before `before`, or
 * (with `after`) only the messages newer than a message already held locally. `theirReadAt` is
 * the most recent time the counterpart read one of the viewer's own messages, present so an
 * `after`-only poll can still refresh an older message's read receipt.
 */
export interface MessagePage {
  messages: Message[];
  truncated: boolean;
  limit: number;
  theirReadAt?: string | null;
}

/** POST /conversations (ConversationsController#create). */
export interface ConversationCreated {
  id: string;
  conversation: { id: string };
}

// ---------------------------------------------------------------------------------------------
// Notifications

/** NotificationsController#index: a notifications row camelCased, with `type` mirroring `kind`. */
export interface Notification {
  id: string;
  userId?: string;
  kind?: string;
  type?: string;
  title?: string;
  body?: string;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

/** GET /notifications/unread (polled by the navigation). */
export interface UnreadCounts {
  unread: number;
  unreadMessages: number;
}

/** GET and PATCH /notifications/preferences. */
export interface NotificationPreferences {
  emailNotifications: boolean;
}

// ---------------------------------------------------------------------------------------------
// Acts and bookings

/** ActMember#api_json (owners and admins) / #public_json (everyone else: confirmed members only). */
export interface ActMember {
  id: string;
  userId?: string | null;
  displayName: string;
  roleName?: string | null;
  instrument?: string | null;
  isLeader: boolean;
  memberStatus?: string;
}

/** Act#api_json (owner/admin) or Act#public_json: the acts row plus members and owner details. */
export interface Act {
  id: string;
  /** Owner and admin views only, like the rider links. */
  owner_id?: string;
  name: string;
  act_type?: string | null;
  currency?: string | null;
  fee_basis?: string | null;
  status: string;
  tagline?: string | null;
  city?: string | null;
  tech_rider_url?: string | null;
  hospitality_rider_url?: string | null;
  promo_url?: string | null;
  bio?: string | null;
  genres: string[];
  languages: string[];
  event_types: string[];
  lineup_size?: number | null;
  min_fee?: number | null;
  max_fee?: number | null;
  travel_radius_km?: number | null;
  travels_nationally?: boolean;
  travels_internationally?: boolean;
  verified?: boolean;
  created_at?: string;
  updated_at?: string;
  members: ActMember[];
  ownerName: string;
  ownerVerified: boolean;
  demo: boolean;
}

/** BookingsController#booking_json's latestQuote. Fees are whole currency units. */
export interface BookingQuote {
  id: string;
  performanceFee: number;
  travelFee: number;
  productionFee: number;
  otherFee: number;
  total: number;
  currency: string;
  depositPercent: number;
  validUntil?: string | null;
  inclusions?: string | null;
  exclusions?: string | null;
  cancellationTerms?: string | null;
  status: string;
  /** Platform fee/GST snapshot from BookingFeePolicy at the time this quote was created. Both 0
   * when the fee is off. */
  feeAmount?: number;
  gstAmount?: number;
  feePercent?: number;
  policyVersion?: number;
}

/** The fee/GST snapshot on a booking's deposit payment (BookingsController#booking_json). */
export interface DepositBreakdown {
  amount: number;
  feeAmount: number;
  gstAmount: number;
  feePercent: number;
  policyVersion: number;
}

/** The current booking fee/cancellation policy in plain words (BookingFeePolicy#plain_english),
 * shown on the quote and booking pages so both parties see the same rules the server enforces. */
export interface BookingPolicy {
  feeEnabled: boolean;
  plainEnglish: string[];
  policyVersion: number;
}

/** BookingsController#booking_json: a booking_requests row plus both sides' view of its state. */
export interface Booking {
  id: string;
  act_id: string;
  requester_id: string;
  event_type?: string | null;
  event_name?: string | null;
  city?: string | null;
  currency?: string | null;
  status: string;
  start_time?: string | null;
  venue_name?: string | null;
  venue_address?: string | null;
  indoor_outdoor?: string | null;
  event_date?: string | null;
  duration_minutes?: number | null;
  audience_size?: number | null;
  budget_min?: number | null;
  budget_max?: number | null;
  requirements?: string | null;
  production_provided?: string[];
  travel_provided?: boolean;
  accommodation_provided?: boolean;
  created_at?: string;
  updated_at?: string;
  actName: string;
  requesterName: string;
  isOwner: boolean;
  isRequester: boolean;
  latestQuoteTotal?: number | null;
  latestQuoteCurrency?: string | null;
  latestDepositPercent?: number | null;
  latestQuote?: BookingQuote | null;
  paidAmount: number;
  paymentCount: number;
  depositPaid: boolean;
  allowedTransitions?: string[];
  depositBreakdown?: DepositBreakdown | null;
  bookingPolicy?: BookingPolicy;
}

/** A booking_payments row as rendered by GET /bookings/:id/payments and POST .../payment-order. */
export interface BookingPayment {
  id: string;
  booking_request_id: string;
  booking_quote_id?: string | null;
  payer_id?: string;
  kind: string;
  currency: string;
  provider: string;
  status: string;
  provider_order_id?: string | null;
  provider_payment_id?: string | null;
  amount: number;
  created_at: string;
  updated_at?: string;
  fee_amount?: number;
  gst_amount?: number;
  fee_percent?: number;
  policy_version?: number;
  /** Present once InvoiceGenerator has created an invoice for this (paid, fee > 0) payment. */
  invoiceId?: string | null;
}

/** POST /bookings/:id/payment-order: the payment row and how to collect it. */
export interface BookingPaymentOrder {
  payment: BookingPayment;
  checkout: RazorpayCheckoutConfig | { mode: 'mock' };
}

// ---------------------------------------------------------------------------------------------
// Catalog

/** CatalogController#taxonomy: the fixed vocabularies forms offer. */
export interface Taxonomy {
  opportunityKinds: string[];
  functionAreas: string[];
  workplaces: string[];
  currencies: string[];
  actTypes: string[];
  eventTypes: string[];
  engagementTypes: string[];
  roleCategories: Record<string, string[]>;
  instruments: string[];
  /** Older function names still accepted by filters, mapped to their current name. */
  legacyFunctionAreas?: Record<string, string>;
  /** Directory role groups (the landing-page tiles): /music-professionals?role=<key>. */
  talentRoles?: { key: string; label: string }[];
}

// ---------------------------------------------------------------------------------------------
// Availability and resources

/** AvailabilityController#index: an availability_windows row camelCased. */
export interface AvailabilityWindow {
  id: string;
  userId?: string;
  startAt: string;
  endAt: string;
  status: string;
  city?: string | null;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** ResourcesController#index: a published career_resources row. */
export interface CareerResource {
  id: string;
  title: string;
  category?: string | null;
  status?: string;
  url?: string | null;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ---------------------------------------------------------------------------------------------
// Admin

/** Admin::TesterController#index: non-destructive runtime checks. */
export interface PlatformCheckReport {
  summary: { passed: number; total: number; failed: number; healthy: boolean; databaseLatencyMs: number };
  checks: { name: string; pass: boolean; detail: string; severity: string }[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------------------------
// Employers and reviews

/** ApplicationController#public_employer. */
export interface PublicEmployer {
  id: string;
  name: string;
  role: Role;
  companyName?: string | null;
  companyWebsite?: string | null;
  companySize?: string | null;
  companyDescription?: string | null;
  headline?: string | null;
  location?: string | null;
  website?: string | null;
  verified: boolean;
  /** ReviewsController#index: employers the job seeker may review (after a completed hire). */
  eligibleForReview?: boolean;
}

/** ReviewsController#index: a published reviews row plus names. */
export interface Review {
  id: string;
  author_id?: string;
  employer_id: string;
  rating: number;
  title?: string | null;
  status: string;
  body?: string | null;
  created_at: string;
  updated_at?: string;
  authorName: string;
  employerName: string;
}

// ---------------------------------------------------------------------------------------------
// Search and alerts

/** SearchController: one hit across jobs, talent, acts and work samples. */
export interface SearchResult {
  type: 'jobs' | 'talent' | 'acts' | 'samples';
  id: string;
  demo: boolean;
  url: string;
  title: string;
  subtitle: string;
  description?: string | null;
  tags: string[];
}

/**
 * How a search read the query (GET /search and every list endpoint given `q`): the words and
 * synonyms searched, and whether a misspelling was corrected or only some words matched.
 */
export interface SearchMeta {
  interpretedAs?: string[];
  /** all: every word matched · corrected: after fixing a misspelling · partial: only some words matched. */
  matchMode?: 'all' | 'corrected' | 'partial';
  /** The corrected query ("guitarist" for "guitarst"). */
  didYouMean?: string;
}

/** GET /search. Without `type`: per-type totals and whether each type has more than it shows. */
export interface SearchResponse extends SearchMeta {
  results: SearchResult[];
  interpretedAs: string[];
  provider: string;
  status: { provider: string; healthy: boolean; fallback: boolean };
  totals?: Partial<Record<SearchResult['type'], number>>;
  moreOf?: Partial<Record<SearchResult['type'], boolean>>;
  /** With `type`: the cursor for the next page, and the match count. */
  nextCursor?: string | null;
  total?: number;
}

/** JobAlertsController#index: a job_alerts row. */
export interface JobAlert {
  id: string;
  user_id?: string;
  name: string;
  query?: string | null;
  location?: string | null;
  opportunity_kind?: string | null;
  function_area?: string | null;
  frequency: string;
  remote_only: boolean;
  active: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ---------------------------------------------------------------------------------------------
// Band builder and crew plans

/** A band_project_roles row (raw column names). */
export interface BandProjectRole {
  id: string;
  band_project_id: string;
  opportunity_id?: string | null;
  role_name: string;
  status: string;
  instrument?: string | null;
  skill_level?: string | null;
  compensation?: string | null;
  count_needed: number;
  requirements?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** BandProjectsController#index: a band_projects row with its roles. */
export interface BandProject {
  id: string;
  owner_id?: string;
  name: string;
  status: string;
  city?: string | null;
  commitment_type?: string | null;
  rehearsal_schedule?: string | null;
  compensation_model?: string | null;
  concept?: string | null;
  genres: string[];
  created_at?: string;
  updated_at?: string;
  roles: BandProjectRole[];
}

/** A crew_plan_roles row camelCased. */
export interface CrewPlanRole {
  id: string;
  crewPlanId?: string;
  category: string;
  roleName: string;
  priority?: string | null;
  instrument?: string | null;
  countNeeded: number;
  rationale?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** CrewPlansController#index: a crew_plans row with its suggested roles. */
export interface CrewPlan {
  id: string;
  owner_id?: string;
  title: string;
  event_type?: string | null;
  city?: string | null;
  currency?: string | null;
  event_date?: string | null;
  audience_size?: number | null;
  budget?: number | null;
  genres: string[];
  needs: string[];
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  roles: CrewPlanRole[];
}

// ---------------------------------------------------------------------------------------------
// Urgent requests and workspaces

/** UrgentRequestsController#index: an urgent_requests row plus the viewer's view of it. */
export interface UrgentRequest {
  id: string;
  requester_id: string;
  title: string;
  role_name: string;
  city: string;
  currency?: string | null;
  status: string;
  instrument?: string | null;
  genre?: string | null;
  /** Required by the model. */
  start_at: string;
  end_at?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  requirements?: string | null;
  travel_covered?: boolean;
  created_at?: string;
  updated_at?: string;
  requesterName: string;
  requesterVerified: boolean;
  myResponse: boolean;
  responseCount: number;
}

/** UrgentRequestsController#responses: an urgent_request_responses row plus the responder. */
export interface UrgentRequestResponse {
  id: string;
  urgent_request_id: string;
  user_id: string;
  message?: string | null;
  rate?: number | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
  name: string;
  headline?: string | null;
}

/** OrganizationsController#organization_json: an organizations row plus the viewer's membership. */
export interface Organization {
  id: string;
  owner_id: string;
  name: string;
  status: string;
  org_type?: string | null;
  website?: string | null;
  city?: string | null;
  tax_id?: string | null;
  billing_email?: string | null;
  created_at?: string;
  updated_at?: string;
  memberCount: number;
  memberRole?: string | null;
}

/** OrganizationsController#members. */
export interface OrganizationMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

// ---------------------------------------------------------------------------------------------
// Billing

/** Billing::BillingController::PLANS. `monthly` is in rupees; null means priced by sales. */
export interface Plan {
  code: string;
  name: string;
  monthly: number | null;
  trialDays: number;
  activePosts: number;
  seats: number;
  shortlist: number;
  bookings: number;
}

/** A subscriptions row (raw column names). */
export interface Subscription {
  id: string;
  user_id: string;
  plan_code: string;
  provider: string;
  status: string;
  provider_subscription_id?: string | null;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Billing::BillingController#billing_history: one webhook-recorded charge. `amount` is in rupees. */
export interface BillingHistoryEntry {
  paymentId: string;
  invoiceId?: string | null;
  amount: number;
  currency: string;
  status: string;
  at: string;
  event: string;
}

/** POST /billing/checkout: a sales hand-off for Enterprise, otherwise the subscription and how to pay. */
export interface BillingCheckout {
  salesAssisted?: boolean;
  message?: string;
  subscription?: Subscription;
  checkout?: RazorpayCheckoutConfig | { mode: 'mock' };
  idempotent?: boolean;
}

/** POST /billing/cancel. */
export interface BillingCancellation {
  ok: boolean;
  outcome: string;
  accessEndsAt?: string | null;
}

// ---------------------------------------------------------------------------------------------
// Admin lists (each capped server-side, newest first)

/** Admin::StatsController#index. */
export interface AdminStats {
  users: number;
  jobseekers: number;
  employers: number;
  verified: number;
  jobs: number;
  liveJobs: number;
  pendingJobs: number;
  applications: number;
  hires: number;
  pendingReviews: number;
  verificationQueue: number;
  openReports: number;
  messages: number;
  flaggedMessages: number;
  acts: number;
  bookings: number;
  acceptedBookings: number;
  paidDeposits: number;
  activeSubscriptions: number;
  trialingSubscriptions: number;
}

/** Admin::UsersController#index: public_user plus the sign-up time. */
export interface AdminUser extends AccountUser {
  createdAt: string;
  synthetic_batch?: string | null;
}

/** Admin::VerificationsController#index: a verification_requests row plus the requester. */
export interface AdminVerification {
  id: string;
  user_id: string;
  kind: string;
  evidence_url?: string | null;
  status: string;
  note?: string | null;
  reviewed_by_id?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at?: string;
  name: string;
  email: string;
  role: Role;
  companyName?: string | null;
}

/** Admin::ReportsController#index: a reports row plus the reporter's name. */
export interface AdminReport {
  id: string;
  reporter_id?: string | null;
  entity_type: string;
  entity_id: string;
  reason: string;
  status: string;
  details?: string | null;
  resolved_by_id?: string | null;
  resolved_at?: string | null;
  action_taken?: string | null;
  resolution_note?: string | null;
  created_at: string;
  updated_at?: string;
  reporterName?: string | null;
  /** A short label for what was reported (job title, act/person name, "Review"), when it still exists. */
  entityTitle?: string | null;
}

/** Admin::ReportsController#index response shape (filters: status/entityType/reason; paged). */
export interface AdminReportsPage {
  reports: AdminReport[];
  total: number;
  page: number;
  perPage: number;
}

/** Admin::OperationsController#audit: an audit_logs row plus the actor's name. */
export interface AuditLogEntry {
  id: string;
  actor_id?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string;
  actorName?: string | null;
}

/** Admin::OperationsController#subscriptions: a subscriptions row plus the subscriber. */
export interface AdminSubscription extends Subscription {
  name: string;
  email: string;
}

/** Admin::OperationsController#billing_attempts: a billing_attempts row plus the user's email. */
export interface BillingAttempt {
  id: string;
  user_id: string;
  operation: string;
  provider: string;
  idempotency_key?: string;
  state: string;
  resource_type?: string | null;
  resource_id?: string | null;
  provider_resource_id?: string | null;
  request_payload?: Record<string, unknown> | null;
  response_payload?: Record<string, unknown> | null;
  error_code?: string | null;
  error_message?: string | null;
  last_attempted_at?: string | null;
  reconciled_at?: string | null;
  created_at: string;
  updated_at?: string;
  email: string;
}

/** Admin::OperationsController#bookings: a booking_requests row plus names and the paid total. */
export interface AdminBooking extends Omit<
  Booking,
  | 'isOwner'
  | 'isRequester'
  | 'latestQuoteTotal'
  | 'latestQuoteCurrency'
  | 'latestDepositPercent'
  | 'latestQuote'
  | 'paymentCount'
  | 'depositPaid'
  | 'allowedTransitions'
> {
  actOwner: string;
}

/** Admin::RefundsController#refund_json: an intended refund from BookingFeePolicy's cancellation
 * or no-show rules. Never moved money on its own — see backend/app/models/refund_record.rb. */
export interface AdminRefund {
  id: string;
  bookingRequestId: string;
  bookingPaymentId?: string | null;
  amount: number;
  currency: string;
  refundPercent: number;
  reason: string;
  status: 'pending_manual' | 'done' | 'not_applicable';
  note?: string | null;
  policyVersion: number;
  requestedBy?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  createdAt: string;
  actName?: string | null;
  requesterName?: string | null;
}

/** Admin::BillingEventsController#summary: one processed Razorpay webhook (no raw payload). */
export interface BillingEventSummary {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  processingResult?: string | null;
  processedAt?: string | null;
  createdAt: string;
  userId?: string | null;
  email?: string | null;
  subscriptionId?: string | null;
  paymentId?: string | null;
  orderId?: string | null;
  /** Paise, as Razorpay reports it. */
  amount?: number | null;
  currency?: string | null;
}

// ---------------------------------------------------------------------------------------------
// Admin site: the signed-in admin's own account

/**
 * How the admin's second sign-in step stands: `enforced` (password + emailed code), `skipped`
 * (the code could not be emailed, so password alone was accepted), `off` (turned off on the
 * server) or `unavailable` (required but cannot be emailed).
 */
export type AdminSecondFactorState = 'enforced' | 'skipped' | 'off' | 'unavailable';

/** Admin::AccountController#show (GET /admin/account): the health of the admin's own sign-in. */
export interface AdminAccountHealth {
  email: string;
  /** False for addresses that can never receive mail (reserved domains, suppressed after bounces). */
  emailDeliverable: boolean;
  secondFactor: AdminSecondFactorState;
  /** Whether the API only accepts admin requests from the admin site's origin. */
  adminOrigin: boolean;
}

/** POST /admin/account/email/request: a code went to the new address; the token confirms it. */
export interface AdminEmailChangeStarted {
  changeToken: string;
  expiresIn: number;
  message?: string;
  /** Only outside production when no email provider is configured. */
  debugCode?: string;
}
