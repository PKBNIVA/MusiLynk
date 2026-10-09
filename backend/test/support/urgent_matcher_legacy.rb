# TEST-ONLY. The Ruby-side ranking that UrgentMatcher::Query replaced (R7, Oct 2026): it loaded
# every discoverable musician in the city in batches of 1,000 and scored each one in Ruby.
#
# Lives in test/support, not app/, so it never ships: it is only the oracle for
# test/services/urgent_matcher_parity_test.rb, which checks that the SQL ranking gives the same
# scores and reasons on a seeded sample. Delete this file and that test's Legacy half once the SQL
# ranking has run in production for a while. Behaviour is the old code's, verbatim, except that
# the weights, the activity window and the default duration are read from config/urgent.yml like
# the new code, so the two stay comparable when the founder retunes them.
class UrgentMatcher::Legacy
  def self.call(request) = new(request).ranked_candidates

  def initialize(request)
    @request = request
  end

  def ranked_candidates
    scope = User.discoverable_talent.includes(:profile).where.not(id: @request.requester_id)
    scope = scope.joins(:profile).where("profiles.location ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(city)}%") if city.present?
    scored = []
    scope.find_in_batches(batch_size: 1_000) do |users|
      preload_signals(users)
      scored.concat(users.filter_map { |user| score(user) })
    end
    scored.sort_by { |c| -c.score }.first(UrgentConfig.candidate_limit)
  end

  private

  def city = @request.city.to_s.strip
  def role = @request.role_name.to_s.strip.downcase
  def instrument = @request.instrument.to_s.strip.downcase

  def score(user)
    return nil if blocked_by_availability?(user)

    profile = user.profile
    roles = Array(profile&.roles)
    instruments = Array(profile&.instruments)
    role_match = role.present? && ((roles + instruments).any? { UrgentMatcher.same_role?(_1, role) } || headline_mentions?(profile, role))
    instrument_match = instrument.present? && instruments.any? { UrgentMatcher.same_role?(_1, instrument) }
    return nil unless role_match || instrument_match || (role.blank? && instrument.blank?)

    reasons = []
    points = 0
    if role_match
      points += UrgentConfig.weight(:role)
      reasons << "Plays #{@request.role_name}"
    end
    if instrument_match
      points += UrgentConfig.weight(:instrument)
      reasons << "Plays #{@request.instrument}" unless reasons.any? { _1.start_with?("Plays") }
    end
    city_match = city.present? && profile&.location.to_s.downcase.include?(city.downcase)
    if city_match
      points += UrgentConfig.weight(:city)
      reasons << "In #{@request.city}"
    end
    if profile&.verified
      points += UrgentConfig.weight(:verified)
      reasons << "Verified"
    end
    last_seen = last_seen_at(user)
    active_recently = last_seen && last_seen >= UrgentConfig.recent_activity_within.ago
    if active_recently
      points += UrgentConfig.weight(:recent_activity)
      reasons << "Active in the last #{UrgentConfig.recent_activity_within_days} days"
    end
    if available_on_request_date?(user)
      points += UrgentConfig.weight(:available)
      reasons << "Available on #{IndianFormat.date_time(@request.start_at).split(',').first}"
    end
    UrgentMatcher::Candidate.new(user:, score: points, reasons: reasons.first(3))
  end

  def headline_mentions?(profile, role)
    wanted = UrgentMatcher.role_tokens(role)
    wanted.any? && wanted.subset?(UrgentMatcher.role_tokens(profile&.headline))
  end

  def available_on_request_date?(user)
    return false unless @request.start_at
    return @available_ids.include?(user.id) if preloaded?(user)
    window_end = @request.end_at || @request.start_at + UrgentConfig.default_duration
    AvailabilityWindow.where(user:, status: "available")
      .where("start_at <= ? AND end_at >= ?", @request.start_at, window_end).exists?
  end

  def blocked_by_availability?(user)
    return false unless @request.start_at
    return @blocked_ids.include?(user.id) if preloaded?(user)
    window_end = @request.end_at || @request.start_at + UrgentConfig.default_duration
    AvailabilityWindow.where(user:, status: %w[unavailable booked hold])
      .where("start_at < ? AND end_at > ?", window_end, @request.start_at).exists?
  end

  def last_seen_at(user)
    @last_seen ||= {}
    @last_seen.fetch(user.id) { @last_seen[user.id] = user.sessions.maximum(:last_seen_at) }
  end

  def preloaded?(user) = @preloaded&.include?(user.id)

  def preload_signals(users)
    ids = users.map(&:id)
    @preloaded ||= Set.new
    @blocked_ids ||= Set.new
    @available_ids ||= Set.new
    @preloaded.merge(ids)
    @last_seen ||= {}
    ids.each { @last_seen[_1] = nil }
    @last_seen.merge!(Session.where(user_id: ids).group(:user_id).maximum(:last_seen_at))
    return unless @request.start_at

    window_end = @request.end_at || @request.start_at + UrgentConfig.default_duration
    @blocked_ids.merge(AvailabilityWindow.where(user_id: ids, status: %w[unavailable booked hold])
      .where("start_at < ? AND end_at > ?", window_end, @request.start_at).distinct.pluck(:user_id))
    @available_ids.merge(AvailabilityWindow.where(user_id: ids, status: "available")
      .where("start_at <= ? AND end_at >= ?", @request.start_at, window_end).distinct.pluck(:user_id))
  end
end
