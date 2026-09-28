# Ranks and notifies musicians for one UrgentRequest ("need someone by tomorrow").
#
# UrgentMatcher.call(request) returns up to UrgentConfig.candidate_limit ranked candidates:
# same city, matching role/instrument, verified first, availability not blocked, recent
# activity as a tiebreak.
#
# UrgentMatcher.notify!(request, ...) sends the alert (in-app + email always; WhatsApp when
# configured and consented, see WhatsappAlerts) to the top UrgentConfig.notify_count of them,
# or to one specific candidate (the admin's "Notify" button). It is idempotent: each
# (request, user, channel) triple is recorded once in urgent_request_notifications (unique
# index idx_urgent_notif_unique), and a repeat call skips anyone already notified on that
# channel rather than alerting them again.
class UrgentMatcher
  Candidate = Struct.new(:user, :score, :reasons, keyword_init: true)

  def self.call(request) = new(request).ranked_candidates

  # actor_admin: the admin user who clicked "Notify" (nil for the automatic post-create pass).
  # only_user_ids: notify exactly these candidates (the admin notifying one person) instead of
  # the automatic top-N fan-out.
  def self.notify!(request, actor_admin: nil, only_user_ids: nil)
    new(request).notify!(actor_admin:, only_user_ids:)
  end

  def initialize(request)
    @request = request
  end

  def ranked_candidates
    scope = User.discoverable_talent.includes(:profile).where.not(id: @request.requester_id)
    scope = scope.joins(:profile).where("profiles.location ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(city)}%") if city.present?
    scored = scope.find_each.filter_map { |user| score(user) }
    scored.sort_by { |c| -c.score }.first(UrgentConfig.candidate_limit)
  end

  def notify!(actor_admin: nil, only_user_ids: nil)
    candidates = if only_user_ids
      User.where(id: only_user_ids).includes(:profile).map { |u| score(u) || Candidate.new(user: u, score: 0, reasons: []) }
    else
      ranked_candidates.first(UrgentConfig.notify_count)
    end

    notified = candidates.filter_map { |candidate| notify_one(candidate.user, actor_admin:) }
    return notified if notified.empty?

    @request.with_lock do
      @request.increment(:notified_count, notified.size)
      @request.first_notified_at ||= Time.current
      @request.last_notified_at = Time.current
      @request.save!
    end
    notified
  end

  private

  def city = @request.city.to_s.strip
  def role = @request.role_name.to_s.strip.downcase
  def instrument = @request.instrument.to_s.strip.downcase

  def score(user)
    return nil if blocked_by_availability?(user)

    profile = user.profile
    roles = Array(profile&.roles).map { _1.to_s.downcase }
    instruments = Array(profile&.instruments).map { _1.to_s.downcase }
    role_match = role.present? && (roles.any? { _1.include?(role) || role.include?(_1) } || profile&.headline.to_s.downcase.include?(role))
    instrument_match = instrument.present? && instruments.any? { _1.include?(instrument) || instrument.include?(_1) }
    return nil unless role_match || instrument_match || (role.blank? && instrument.blank?)

    reasons = []
    points = 0
    if role_match
      points += 40
      reasons << "Role match"
    end
    if instrument_match
      points += 20
      reasons << "Instrument match"
    end
    if city.present? && profile&.location.to_s.downcase.include?(city.downcase)
      points += 25
      reasons << "Same city"
    end
    if profile&.verified
      points += 20
      reasons << "Verified"
    end
    last_seen = last_seen_at(user)
    if last_seen && last_seen >= UrgentConfig.recent_activity_within.ago
      points += 10
      reasons << "Recently active"
    end
    Candidate.new(user:, score: points, reasons:)
  end

  # An availability window the candidate marked "unavailable"/"booked"/"hold" that overlaps the
  # request's window blocks them from being matched at all (not just scored lower).
  def blocked_by_availability?(user)
    return false unless @request.start_at
    window_end = @request.end_at || @request.start_at + 3.hours
    AvailabilityWindow.where(user:, status: %w[unavailable booked hold])
      .where("start_at < ? AND end_at > ?", window_end, @request.start_at).exists?
  end

  def last_seen_at(user)
    @last_seen ||= {}
    @last_seen.fetch(user.id) { @last_seen[user.id] = user.sessions.maximum(:last_seen_at) }
  end

  def notify_one(user, actor_admin:)
    any_new = false
    if record_notification!(user, "in_app", actor_admin)
      Notifier.urgent_request_alert(@request, user)
      any_new = true
    end
    if WhatsappAlerts.enabled? && WhatsappAlerts.eligible?(user) && record_notification!(user, "whatsapp", actor_admin)
      WhatsappAlertJob.perform_later(@request.id, user.id)
      any_new = true
    end
    any_new ? user : nil
  end

  # Inserts the (request, user, channel) row if it doesn't exist yet; returns true only for a
  # fresh insert, so a repeat call never re-notifies. Relies on idx_urgent_notif_unique to stay
  # correct under races (two admins clicking "Notify" at once).
  def record_notification!(user, channel, actor_admin)
    UrgentRequestNotification.create!(urgent_request: @request, user:, channel:, notified_by_admin: actor_admin)
    true
  rescue ActiveRecord::RecordNotUnique
    false
  end
end
