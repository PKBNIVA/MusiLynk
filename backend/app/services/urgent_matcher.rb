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

  # Roles and instruments are compared by meaning, never as substrings, so a Dholak player is not
  # a "Dhol" player. Names are resolved through the shared search vocabulary (Search::Synonyms,
  # config/search_synonyms.yml): "Gayak", "Vocalist" and "Playback Singer" are one role, as are
  # "Tabla Vadak" and "Tablist", "Bansuri Player" and "Flautist", "Keys Player" and "Keyboardist".
  # Words that only say "someone who plays" are dropped from names the vocabulary does not know.
  FILLER_WORDS = %w[player players artist artiste musician musicians the and of kit].freeze

  # The comparable parts of a role or instrument name: the vocabulary's canonical term when the
  # whole name is known ("Lead Vocalist" => {"singer"}), otherwise its words, each resolved
  # the same way ("Electric Guitarist" => {"electric", "guitarist"}).
  def self.role_tokens(text)
    phrase = text.to_s.downcase.split(/[^[:alnum:]]+/).reject(&:empty?).join(" ")
    return Set.new if phrase.empty?
    whole = Search::Synonyms.canonical(phrase)
    return Set[whole] if whole
    words = phrase.split.reject { FILLER_WORDS.include?(_1) }
    stripped = Search::Synonyms.canonical(words.join(" "))
    return Set[stripped] if stripped
    words.map { Search::Synonyms.canonical(_1) || _1 }.to_set
  end

  # Whether two names mean the same thing: all the words of the shorter one appear in the other.
  def self.same_role?(a, b)
    left = role_tokens(a)
    right = role_tokens(b)
    return false if left.empty? || right.empty?
    left.subset?(right) || right.subset?(left)
  end

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
    scored = []
    # Availability and last-seen are looked up once per batch of 1,000 people, not once per person:
    # a city-wide fan-out used to cost 1-3 queries per candidate inside the posting request.
    scope.find_in_batches(batch_size: 1_000) do |users|
      preload_signals(users)
      scored.concat(users.filter_map { |user| score(user) })
    end
    scored.sort_by { |c| -c.score }.first(UrgentConfig.candidate_limit)
  end

  def notify!(actor_admin: nil, only_user_ids: nil)
    candidates = if only_user_ids
      User.where(id: only_user_ids).includes(:profile).map { |u| score(u) || Candidate.new(user: u, score: 0, reasons: []) }
    else
      ranked_candidates.first(UrgentConfig.notify_count)
    end

    notified = candidates.filter_map { |candidate| notify_one(candidate, actor_admin:) }
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
    roles = Array(profile&.roles)
    instruments = Array(profile&.instruments)
    role_match = role.present? && ((roles + instruments).any? { self.class.same_role?(_1, role) } || headline_mentions?(profile, role))
    instrument_match = instrument.present? && instruments.any? { self.class.same_role?(_1, instrument) }
    return nil unless role_match || instrument_match || (role.blank? && instrument.blank?)

    reasons = []
    points = 0
    if role_match
      points += 40
      reasons << "Plays #{@request.role_name}"
    end
    if instrument_match
      points += 20
      reasons << "Plays #{@request.instrument}" unless reasons.any? { _1.start_with?("Plays") }
    end
    city_match = city.present? && profile&.location.to_s.downcase.include?(city.downcase)
    if city_match
      points += 25
      reasons << "In #{@request.city}"
    end
    if profile&.verified
      points += 20
      reasons << "Verified"
    end
    last_seen = last_seen_at(user)
    active_recently = last_seen && last_seen >= UrgentConfig.recent_activity_within.ago
    if active_recently
      points += 10
      reasons << "Active in the last 30 days"
    end
    if available_on_request_date?(user)
      points += 5
      reasons << "Available on #{IndianFormat.date_time(@request.start_at).split(',').first}"
    end
    Candidate.new(user:, score: points, reasons: reasons.first(3))
  end

  # The headline names the role in whole words ("Dholak player" does not name "Dhol").
  def headline_mentions?(profile, role)
    wanted = self.class.role_tokens(role)
    wanted.any? && wanted.subset?(self.class.role_tokens(profile&.headline))
  end

  # An AvailabilityWindow the candidate explicitly marked "available" that covers the
  # request's start time — a positive signal distinct from just not being blocked.
  def available_on_request_date?(user)
    return false unless @request.start_at
    return @available_ids.include?(user.id) if preloaded?(user)
    window_end = @request.end_at || @request.start_at + 3.hours
    AvailabilityWindow.where(user:, status: "available")
      .where("start_at <= ? AND end_at >= ?", @request.start_at, window_end).exists?
  end

  # An availability window the candidate marked "unavailable"/"booked"/"hold" that overlaps the
  # request's window blocks them from being matched at all (not just scored lower).
  def blocked_by_availability?(user)
    return false unless @request.start_at
    return @blocked_ids.include?(user.id) if preloaded?(user)
    window_end = @request.end_at || @request.start_at + 3.hours
    AvailabilityWindow.where(user:, status: %w[unavailable booked hold])
      .where("start_at < ? AND end_at > ?", window_end, @request.start_at).exists?
  end

  def last_seen_at(user)
    @last_seen ||= {}
    @last_seen.fetch(user.id) { @last_seen[user.id] = user.sessions.maximum(:last_seen_at) }
  end

  def preloaded?(user) = @preloaded&.include?(user.id)

  # One query each for the three per-person signals, for a whole batch of users. score() falls back
  # to a per-user query for anyone not preloaded (the admin's single-person "Notify").
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

    window_end = @request.end_at || @request.start_at + 3.hours
    @blocked_ids.merge(AvailabilityWindow.where(user_id: ids, status: %w[unavailable booked hold])
      .where("start_at < ? AND end_at > ?", window_end, @request.start_at).distinct.pluck(:user_id))
    @available_ids.merge(AvailabilityWindow.where(user_id: ids, status: "available")
      .where("start_at <= ? AND end_at >= ?", @request.start_at, window_end).distinct.pluck(:user_id))
  end

  def notify_one(candidate, actor_admin:)
    user = candidate.user
    any_new = false
    if record_notification!(user, "in_app", actor_admin, candidate.reasons)
      Notifier.urgent_request_alert(@request, user, candidate.reasons)
      any_new = true
    end
    if WhatsappAlerts.enabled? && WhatsappAlerts.eligible?(user) && record_notification!(user, "whatsapp", actor_admin, candidate.reasons)
      WhatsappAlertJob.perform_later(@request.id, user.id)
      any_new = true
    end
    any_new ? user : nil
  end

  # Inserts the (request, user, channel) row if it doesn't exist yet; returns true only for a
  # fresh insert, so a repeat call never re-notifies. Relies on idx_urgent_notif_unique to stay
  # correct under races (two admins clicking "Notify" at once).
  def record_notification!(user, channel, actor_admin, reasons = [])
    UrgentRequestNotification.create!(urgent_request: @request, user:, channel:, notified_by_admin: actor_admin, reasons:)
    true
  rescue ActiveRecord::RecordNotUnique
    false
  end
end
