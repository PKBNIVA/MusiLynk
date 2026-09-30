# Conditions for the day-N onboarding sequence (LifecycleEmailsJob). Each `send_*` method
# re-checks its condition right before enqueuing — the condition must still hold at send
# time, not just on the day the user signed up — and is idempotent via LifecycleEmail.
#
# Musicians are `role: "jobseeker"`; hirers are `role: "employer"` (User's actual roles).
class LifecycleSequences
  INACTIVE_AFTER = 14.days

  RATE_FIELDS = %i[hourly_rate session_rate show_rate tour_day_rate day_rate].freeze

  def self.run(now = Time.current)
    new(now).run
  end

  # True when the email may be enqueued: the recipient can actually be emailed (provider
  # configured, verified address, opted in to the step's category) AND this call is the first to
  # claim (user, key). Deliverability is checked first so a step is never marked as sent, and so
  # burned for good, when nothing can be delivered.
  def self.claim(user, key)
    return false unless NotificationEmail.deliverable_to?(user, category: LifecycleMailer.step_category(key))

    LifecycleEmail.record!(user, key)
  end

  def initialize(now)
    @now = now
  end

  def run
    send_musician_day(1) { |user| musician_day1?(user) }
    send_musician_day(3) { |user| musician_day3?(user) }
    send_musician_day(5) { |user| musician_day5?(user) }
    send_musician_day(10) { |user| musician_day10?(user) }
    send_musician_inactive
    send_hirer_day(1) { |user| hirer_day1?(user) }
    send_hirer_day3
    send_hirer_day7
    send_hirer_inactive
  end

  private

  attr_reader :now

  def users_created_on(days_ago, role)
    User.where(role:).where(created_at: (days_ago.days.ago.beginning_of_day)..(days_ago.days.ago.end_of_day))
  end

  # --- Musician sequence --------------------------------------------------------
  def send_musician_day(day)
    key = { 1 => "musician_day1_first_link", 3 => "musician_day3_verified_badge",
            5 => "musician_day5_set_availability", 10 => "musician_day10_add_rates" }.fetch(day)
    users_created_on(day, "jobseeker").find_each do |user|
      next unless yield(user)
      next unless self.class.claim(user, key)

      LifecycleEmailDeliveryJob.perform_later(user.id, key)
    end
  end

  def musician_day1?(user) = user.portfolio_items.count.zero?
  def musician_day3?(user) = !user.verification_requests.exists?
  def musician_day5?(user) = user.profile&.availability.blank?
  def musician_day10?(user) = user.profile.nil? || RATE_FIELDS.all? { |f| user.profile.public_send(f).nil? }

  # Day 21, only for musicians inactive for 14+ days: real count of open urgent requests
  # matching their city (and role, when they listed one), skipped when there are none.
  def send_musician_inactive
    key = "musician_day21_inactive_requests"
    User.where(role: "jobseeker").where(created_at: ...(21.days.ago))
      .where("last_login_at IS NULL OR last_login_at < ?", INACTIVE_AFTER.ago)
      .find_each do |user|
        next if LifecycleEmail.sent?(user, key)

        count = matching_open_requests_count(user)
        next if count.zero?
        next unless self.class.claim(user, key)

        LifecycleEmailDeliveryJob.perform_later(user.id, key, { count:, city: user.profile&.location.presence || "your area" })
      end
  end

  def matching_open_requests_count(user)
    scope = UrgentRequest.open_and_recent
    city = user.profile&.location
    scope = scope.where("city ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(city)}%") if city.present?
    roles = Array(user.profile&.roles)
    scope = scope.where("role_name IN (?) OR instrument IN (?)", roles, roles) if roles.any?
    scope.count
  end

  # --- Hirer sequence ------------------------------------------------------------
  def send_hirer_day(day)
    key = "hirer_day1_post_or_urgent"
    users_created_on(day, "employer").find_each do |user|
      next unless yield(user)
      next unless self.class.claim(user, key)

      LifecycleEmailDeliveryJob.perform_later(user.id, key)
    end
  end

  def hirer_day1?(user) = user.jobs.count.zero? && user.urgent_requests.count.zero?

  # Day 3: five real verified musicians matching the hirer's most-posted role and city.
  # Skipped (no row recorded, so it can still fire once real data exists) when fewer than 3.
  def send_hirer_day3
    key = "hirer_day3_meet_verified"
    users_created_on(3, "employer").find_each do |user|
      next if LifecycleEmail.sent?(user, key)

      city = user.profile&.location
      role = top_posted_role(user)
      next if city.blank? || role.blank?

      matches = matching_verified_musicians(city:, role:)
      next if matches.size < 3

      next unless self.class.claim(user, key)

      LifecycleEmailDeliveryJob.perform_later(user.id, key, { city:, role: })
    end
  end

  # The instrument/role a hirer's own listings look for (job.skills, e.g. "Vocalist",
  # "Drummer"), not the musical genre — matched against musicians' Profile#roles.
  def top_posted_role(user)
    user.jobs.order(created_at: :desc).limit(20).flat_map(&:skills).compact.first
  end

  def matching_verified_musicians(city:, role:)
    Profile.joins(:user).where(users: { role: "jobseeker", status: "active" }).where(verified: true)
      .where("location ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(city)}%")
      .where("roles::text ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(role)}%")
      .limit(5)
  end

  # Day 7: any published job with at least one applicant still at the default (not-yet-viewed)
  # status, for a hirer who posted 7 days ago.
  def send_hirer_day7
    key = "hirer_day7_listing_applicants"
    users_created_on(7, "employer").find_each do |user|
      next if LifecycleEmail.sent?(user, key)

      job = user.jobs.where(status: "published").joins(:applications).where(applications: { status: "Applied" })
        .group("jobs.id").order("COUNT(applications.id) DESC").first
      next unless job
      next unless self.class.claim(user, key)

      count = job.applications.where(status: "Applied").count
      LifecycleEmailDeliveryJob.perform_later(user.id, key, { title: job.title, count: })
    end
  end

  # Day 14, only for hirers inactive for 14+ days: real median first-response time on urgent
  # requests, skipped when there is no data yet.
  def send_hirer_inactive
    key = "hirer_day14_inactive_response_time"
    User.where(role: "employer").where(created_at: ...(14.days.ago))
      .where("last_login_at IS NULL OR last_login_at < ?", INACTIVE_AFTER.ago)
      .find_each do |user|
        next if LifecycleEmail.sent?(user, key)

        city = user.profile&.location
        hours = ResponseTimeStats.median_hours(city:)
        next if hours.nil?
        next unless self.class.claim(user, key)

        LifecycleEmailDeliveryJob.perform_later(user.id, key, { city: city.presence || "your area", hours: })
      end
  end
end
