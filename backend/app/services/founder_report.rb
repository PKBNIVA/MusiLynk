# The numbers behind the Monday founder email (FounderReportJob). One Monday-to-Sunday week in
# IST, each figure next to the week before, organic accounts only: synthetic QA and demo users,
# and everything they own or send, are left out (User.organic).
#
# Waiting counts ("Needs you", verification, reports) are live; their "a week ago" comparison is
# rebuilt from created/reviewed/resolved times. Bookings have no per-status timestamps, so
# "accepted" and "completed" count bookings now in that status whose last change fell in the week.
class FounderReport
  ZONE = IndianFormat::ZONE
  LIST_LIMIT = 5
  URGENT_UNANSWERED_AFTER = 2.hours
  Window = Struct.new(:starts_at, :ends_at, keyword_init: true) do
    def range = starts_at...ends_at
  end

  STEP_LABELS = {
    "landing_view" => "visited Verse",
    "path_chosen" => "chose musician or hirer",
    "signup_completed" => "signed up",
    "first_action" => "took a first action",
    "booking_or_urgent_filled" => "booked or filled a request"
  }.freeze
  TABS = { opportunities: "queue", verification: "verification", reports: "reports", urgent: "urgent", problems: ProblemReportNotifier::TAB }.freeze

  attr_reader :window, :previous_window, :now

  # The Monday-to-Sunday week (IST) that ended before `now`.
  def self.week_before(now)
    this_monday = now.in_time_zone(ZONE).beginning_of_week(:monday).beginning_of_day
    Window.new(starts_at: this_monday - 1.week, ends_at: this_monday)
  end

  def self.recipients
    configured = ENV["FOUNDER_REPORT_TO"].to_s.split(/[,;\s]+/).map(&:strip).reject(&:blank?).uniq
    return configured if configured.any?

    User.where(role: "admin", status: "active", synthetic_batch: nil).order(:created_at).pluck(:email).uniq
  end

  # Where the admin console lives: its own site when ADMIN_ORIGIN is set, otherwise the public site.
  def self.admin_url(tab = nil)
    base = "#{AdminOrigin.configured || FrontendUrl.base}/admin"
    tab ? "#{base}?tab=#{tab}" : base
  end

  def initialize(now: Time.current)
    @now = now
    @window = self.class.week_before(now)
    @previous_window = Window.new(starts_at: window.starts_at - 1.week, ends_at: window.starts_at)
  end

  def call
    this_week = week_numbers(window)
    last_week = week_numbers(previous_window)
    {
      week: { startsAt: window.starts_at, endsAt: window.ends_at, label: week_label },
      current: this_week,
      previous: last_week,
      quiet: quiet?(this_week),
      waiting: waiting,
      needsYou: needs_you,
      funnel: funnel,
      earlyAccess: { used: EarlyAccessGrant.seats_taken, total: BillingConfig.early_access_seats },
      links: TABS.transform_values { self.class.admin_url(_1) }
    }
  end

  def week_label
    first = window.starts_at.in_time_zone(ZONE)
    last = (window.ends_at - 1.second).in_time_zone(ZONE)
    if first.month == last.month && first.year == last.year
      "#{first.day}–#{last.strftime('%-d %b %Y')}"
    else
      "#{first.strftime('%-d %b')} – #{last.strftime('%-d %b %Y')}"
    end
  end

  private

  def organic = User.organic.select(:id)

  # Nothing from real accounts this week: no sign-ups, opportunities, requests, applications,
  # enquiries or messages.
  def quiet?(numbers)
    %i[musicians hirers opportunities urgent applications enquiries messages].all? { numbers[_1].zero? }
  end

  def week_numbers(win)
    range = win.range
    signups = User.organic.where(role: %w[jobseeker employer], created_at: range)
    urgent = UrgentRequest.where(requester_id: organic, created_at: range)
    {
      musicians: signups.where(role: "jobseeker").count,
      musiciansComplete: signups.where(role: "jobseeker", profile_complete: true).count,
      hirers: signups.where(role: "employer").count,
      hirersComplete: signups.where(role: "employer", profile_complete: true).count,
      opportunities: Job.where(employer_id: organic, created_at: range).where.not(status: "draft").count,
      approved: Job.where(employer_id: organic, published_at: range).count,
      urgent: urgent.count,
      urgentResponded: urgent.where(id: UrgentRequestResponse.select(:urgent_request_id)).count,
      urgentFilled: UrgentRequest.where(requester_id: organic, status: "filled", updated_at: range).count,
      urgentMedianMinutes: median_first_response(win),
      applications: Application.where(candidate_id: organic, job_id: Job.where(employer_id: organic).select(:id), created_at: range).count,
      enquiries: bookings.where(created_at: range).count,
      quotes: BookingQuote.where(booking_request_id: bookings.select(:id), created_by_id: organic, created_at: range).count,
      bookingsAccepted: bookings.where(status: "accepted", updated_at: range).count,
      bookingsCompleted: bookings.where(status: "completed", updated_at: range).count,
      messages: Message.where(sender_id: organic, created_at: range,
        conversation_id: Conversation.where(candidate_id: organic, employer_id: organic).select(:id)).count,
      problemReports: problem_reports.where(created_at: range).count
    }
  end

  def bookings
    BookingRequest.where(requester_id: organic, act_id: Act.where(owner_id: organic).select(:id))
  end

  # "Report a problem" messages from real accounts and signed-out visitors (never synthetic/demo users).
  def problem_reports = ProblemReport.where("problem_reports.user_id IS NULL OR problem_reports.user_id IN (?)", organic)

  def problem_reports_waiting(at)
    scope = problem_reports.where(created_at: ...at)
    return scope.where(status: "new") if at >= now

    scope.where("status = 'new' OR handled_at >= ?", at)
  end

  def median_first_response(win)
    ResponseTimeStats.median_minutes(since: win.starts_at, before: win.ends_at)
  end

  # Live queue sizes, with the same queue as it stood a week ago where the data can say.
  def waiting
    pending_jobs = Job.where(employer_id: organic, status: "pending")
    pending_verifications = verification_requests_waiting(now)
    open_reports = reports_waiting(now)
    week_ago = now - 1.week
    {
      opportunities: pending_jobs.count,
      oldestOpportunityAt: pending_jobs.minimum(:created_at),
      verification: pending_verifications.count,
      verificationWeekAgo: verification_requests_waiting(week_ago).count,
      reports: open_reports.count,
      reportsWeekAgo: reports_waiting(week_ago).count,
      problemReports: problem_reports_waiting(now).count,
      problemReportsWeekAgo: problem_reports_waiting(week_ago).count
    }
  end

  def verification_requests_waiting(at)
    scope = VerificationRequest.where(user_id: organic).where(created_at: ...at)
    return scope.where(status: "pending") if at >= now

    scope.where("status = 'pending' OR reviewed_at >= ?", at)
  end

  def reports_waiting(at)
    scope = Report.where(created_at: ...at).where("reporter_id IS NULL OR reporter_id IN (?)", organic)
    return scope.where(status: "open") if at >= now

    scope.where("status = 'open' OR resolved_at >= ?", at)
  end

  def needs_you
    {
      opportunities: Job.where(employer_id: organic, status: "pending").includes(:employer).order(:created_at).limit(LIST_LIMIT)
        .map { |job| { text: "#{job.title} (#{job.employer&.name})", since: job.created_at } },
      verification: verification_requests_waiting(now).includes(:user).order(:created_at).limit(LIST_LIMIT)
        .map { |vr| { text: "#{vr.user&.name}, #{vr.kind.to_s.tr('_', ' ')}", since: vr.created_at } },
      reports: reports_waiting(now).order(:created_at).limit(LIST_LIMIT)
        .map { |report| { text: "#{report.entity_type.to_s.downcase} report: #{report.reason.to_s.tr('_', ' ')}", since: report.created_at } },
      reportsTotal: reports_waiting(now).count,
      problemReports: problem_reports_waiting(now).order(:created_at).limit(LIST_LIMIT)
        .map { |report| { text: "problem report: #{report.description.to_s.squish.truncate(60)}", since: report.created_at } },
      problemReportsTotal: problem_reports_waiting(now).count,
      urgent: unanswered_urgent.order(:created_at).limit(LIST_LIMIT)
        .map { |request| { text: "#{request.title} in #{request.city}", since: request.created_at } },
      urgentTotal: unanswered_urgent.count
    }
  end

  def unanswered_urgent
    UrgentRequest.where(requester_id: organic, status: "open")
      .where(created_at: ..(now - URGENT_UNANSWERED_AFTER))
      .where.not(id: UrgentRequestResponse.select(:urgent_request_id))
  end

  def funnel
    this_week = FunnelQueries.funnel(window.starts_at, window.ends_at)
    last_week = FunnelQueries.funnel(previous_window.starts_at, previous_window.ends_at)
    { steps: this_week, previousSteps: last_week, biggestDropOff: biggest_drop_off(this_week), labels: STEP_LABELS }
  end

  # The step pair that lost the largest share of people. Pairs where the next step is not
  # smaller (the funnel counts distinct visitors per step, not a strict join) are ignored.
  def biggest_drop_off(steps)
    pairs = steps.each_cons(2).filter_map do |from, to|
      next unless from[:count].positive? && to[:count] < from[:count]

      { from: from[:step], to: to[:step], fromCount: from[:count], toCount: to[:count],
        lostPercent: (100.0 * (from[:count] - to[:count]) / from[:count]).round }
    end
    pairs.max_by { _1[:lostPercent] }
  end
end
