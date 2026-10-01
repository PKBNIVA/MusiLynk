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

  # The email's subject: the count and name of the thing the fullest list holds ("3 urgent
  # requests near you this week"), or the plain title when no list has anything in it. Each
  # list names itself with `noun` (singular) and `where` (what follows the count).
  def self.subject_for(sections)
    largest = sections.select { _1[:noun].present? }.max_by { Array(_1[:items]).size }
    count = Array(largest&.dig(:items)).size
    return "This week on Verse" unless count.positive?

    "#{count} #{largest[:noun].pluralize(count)} #{largest[:where]} this week"
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
      section("Urgent requests near you", matching_open_requests(profile), noun: "urgent request", where: "near you"),
      section("New opportunities matching your roles", matching_jobs(profile), noun: "new opportunity", where: "matching your roles"),
      { heading: "Your profile", items: [], footnote: profile_views_footnote },
      { heading: "New in your city", items: [], footnote: newly_verified_footnote(profile) },
      { heading: "Across Verse", items: [], footnote: community_footnote }
    ]
  end

  def matching_open_requests(profile)
    scope = ResponseTimeStats.organic_requests.open_and_recent.order(created_at: :desc).limit(MAX_ITEMS)
    city = profile&.location
    scope = scope.where("city ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(city)}%") if city.present?
    roles = Array(profile&.roles)
    scope = scope.where("role_name IN (?) OR instrument IN (?)", roles, roles) if roles.any?
    scope.map { |r| { text: "#{r.title}: #{r.role_name} needed in #{r.city}, #{IndianFormat.date_time(r.start_at)}", link: "#{app_url}/urgent" } }
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
    return nil if count.zero?

    "Your profile had #{count} #{'view'.pluralize(count)} this week."
  end

  def newly_verified_footnote(profile)
    city = profile&.location
    scope = VerificationRequest.where(status: "approved", reviewed_at: since..until_time)
    scope = scope.joins(user: :profile).where(profiles: { location: city }) if city.present?
    count = scope.count
    return nil if count.zero?

    "New in #{city.presence || 'your area'}: #{count} newly verified #{'musician'.pluralize(count)}."
  end

  def community_footnote
    count = ResponseTimeStats.organic_requests.where(status: "filled", updated_at: since..until_time).count
    return nil if count.zero?

    "#{count} #{'request'.pluralize(count)} #{count == 1 ? 'was' : 'were'} filled through Verse this week."
  end

  # --- Hirer digest ----------------------------------------------------------------
  def hirer_sections
    [
      section("Newly verified musicians in #{city_name}", newly_verified_musicians, noun: "newly verified musician", where: "in #{city_name}"),
      section("Your open opportunities and requests", open_listings_status, noun: "update", where: "on your opportunities and requests"),
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
      { text: "#{vr.user.name} — #{profile.headline || profile.roles&.first}", link: "#{NotificationEmail.frontend_url}/professionals/#{vr.user_id}" }
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
    job_items = jobs.map { |j| { text: "#{j.title}: #{j.applicant_count} #{'applicant'.pluralize(j.applicant_count)}", link: "#{app_url}/applications" } }
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

      { text: "#{responder.name.split.first} (#{responder.profile&.roles&.first || 'musician'}) — median #{minutes.round} min", link: "#{NotificationEmail.frontend_url}/professionals/#{user_id}" }
    end
  end

  def city_name = user.profile&.location.presence || "your city"

  def section(heading, items, noun: nil, where: nil)
    { heading:, items:, footnote: nil, noun:, where: }
  end
end
