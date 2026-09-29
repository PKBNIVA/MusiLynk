# Builds the weekly digest sections for one user (WeeklyDigestJob). Returns an array of
# { heading:, items: [{ text:, link: }], footnote: } hashes, or [] when there's nothing to
# say — the caller (LifecycleMailer.render_digest) skips the whole email in that case.
#
# Musicians are `role: "jobseeker"`; hirers are `role: "employer"`.
class WeeklyDigest
  MAX_ITEMS = 5
  MAX_VERIFIED = 6

  def self.build(user, since:, until_time: Time.current)
    new(user, since:, until_time:).build
  end

  def initialize(user, since:, until_time:)
    @user = user
    @since = since
    @until_time = until_time
  end

  def build
    user.role == "employer" ? hirer_sections : musician_sections
  end

  private

  attr_reader :user, :since, :until_time

  def app_url = NotificationEmail.frontend_url + NotificationEmail.workspace(user)

  # --- Musician digest -----------------------------------------------------------
  def musician_sections
    profile = user.profile
    [
      section("Urgent requests near you", matching_open_requests(profile), footnote: nil),
      section("New jobs matching your roles", matching_jobs(profile), footnote: nil),
      { heading: "Your profile", items: [], footnote: profile_views_footnote },
      { heading: "New in your city", items: [], footnote: newly_verified_footnote(profile) },
      { heading: "This week on Verse", items: [], footnote: community_footnote }
    ]
  end

  def matching_open_requests(profile)
    scope = UrgentRequest.open_and_recent.order(created_at: :desc).limit(MAX_ITEMS)
    city = profile&.location
    scope = scope.where("city ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(city)}%") if city.present?
    roles = Array(profile&.roles)
    scope = scope.where("role_name IN (?) OR instrument IN (?)", roles, roles) if roles.any?
    scope.map { |r| { text: "#{r.role_name} needed in #{r.city}", link: "#{app_url}/urgent" } }
  end

  def matching_jobs(profile)
    scope = Job.published.where(created_at: since..until_time).order(created_at: :desc).limit(MAX_ITEMS)
    genres = Array(profile&.genres)
    scope = scope.where(genre: genres) if genres.any?
    scope.map { |j| { text: "#{j.title} at #{j.company}", link: "#{app_url}/jobs/#{j.id}" } }
  end

  def profile_views_footnote
    count = ProductEvent.named("profile_view").where(created_at: since..until_time)
      .where("props->>'profileId' = ?", user.id).count
    "Your profile: #{count} #{'view'.pluralize(count)} this week."
  end

  def newly_verified_footnote(profile)
    city = profile&.location
    scope = VerificationRequest.where(status: "approved", reviewed_at: since..until_time)
    scope = scope.joins(user: :profile).where(profiles: { location: city }) if city.present?
    count = scope.count
    "New in #{city.presence || 'your area'}: #{count} newly verified #{'musician'.pluralize(count)}."
  end

  def community_footnote
    count = UrgentRequest.where(status: "filled", updated_at: since..until_time).count
    "#{count} #{'request'.pluralize(count)} were filled through Verse this week."
  end

  # --- Hirer digest ----------------------------------------------------------------
  def hirer_sections
    [
      section("Newly verified musicians in #{user.profile&.location.presence || 'your city'}", newly_verified_musicians, footnote: nil),
      section("Your open listings and requests", open_listings_status, footnote: nil),
      { heading: "Response time this week", items: [], footnote: response_time_footnote },
      { heading: "Fastest responders this week", items: fastest_responders, footnote: nil }
    ]
  end

  # Musicians approved as verified in the window (VerificationRequest, not the profile's own
  # created_at, which predates verification), for the instrument/role the hirer's own listings
  # look for (job.skills, e.g. "Vocalist") and their city.
  def newly_verified_musicians
    city = user.profile&.location
    roles = posted_roles
    scope = VerificationRequest.where(status: "approved", reviewed_at: since..until_time)
      .joins(user: :profile).where(users: { role: "jobseeker", status: "active" }).limit(MAX_VERIFIED)
    scope = scope.where(profiles: { location: city }) if city.present?
    scope = scope.where("profiles.roles::text ~* ?", roles.map { Regexp.escape(_1) }.join("|")) if roles.any?
    scope.map do |vr|
      profile = vr.user.profile
      { text: "#{vr.user.name} — #{profile.headline || profile.roles&.first}", link: "#{NotificationEmail.frontend_url}/talent/#{vr.user_id}" }
    end
  end

  # The instrument/role the hirer's own listings look for (job.skills, e.g. "Vocalist",
  # "Drummer"), not the musical genre — matched against musicians' Profile#roles.
  def posted_roles
    user.jobs.order(created_at: :desc).limit(20).flat_map(&:skills).compact.uniq
  end

  def open_listings_status
    jobs = user.jobs.where(status: "published").left_joins(:applications).group(:id)
      .select("jobs.*, COUNT(applications.id) AS applicant_count").limit(MAX_ITEMS)
    requests = user.urgent_requests.where(status: "open").limit(MAX_ITEMS)
    job_items = jobs.map { |j| { text: "#{j.title}: #{j.applicant_count} applicant#{'s' unless j.applicant_count == 1}", link: "#{app_url}/applicants" } }
    request_items = requests.map { |r| { text: "#{r.title}: #{r.urgent_request_responses.count} response#{'s' unless r.urgent_request_responses.count == 1}", link: "#{app_url}/urgent" } }
    (job_items + request_items).first(MAX_ITEMS)
  end

  def response_time_footnote
    hours = ResponseTimeStats.median_hours(city: user.profile&.location, since:)
    return nil if hours.nil?

    "Median first response this week: #{hours} hours."
  end

  def fastest_responders
    ResponseTimeStats.fastest_responders(city: user.profile&.location, since:).filter_map do |user_id, minutes|
      responder = User.find_by(id: user_id)
      next unless responder

      { text: "#{responder.name.split.first} (#{responder.profile&.roles&.first || 'musician'}) — median #{minutes.round} min", link: "#{NotificationEmail.frontend_url}/talent/#{user_id}" }
    end
  end

  def section(heading, items, footnote:)
    { heading:, items:, footnote: }
  end
end
