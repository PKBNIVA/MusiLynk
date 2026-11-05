# Ranks and notifies musicians for one UrgentRequest ("need someone by tomorrow").
#
# UrgentMatcher.call(request) returns up to UrgentConfig.candidate_limit ranked candidates:
# same city, matching role/instrument, verified first, availability not blocked, recent
# activity as a tiebreak. The selection and the scoring are one SQL statement
# (UrgentMatcher::Query); Ruby only loads the top rows and words their reasons, so a request
# costs the same three queries whether the city has 30 musicians or 30,000. The weights are in
# config/urgent.yml (UrgentConfig.weights).
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
  # the same way ("Electric Guitarist" => {"electric", "guitarist"}). UrgentMatcher::Query applies
  # the same rule in SQL; change both together.
  def self.role_tokens(text)
    phrase = normalize_phrase(text)
    return Set.new if phrase.empty?
    whole = Search::Synonyms.canonical(phrase)
    return Set[whole] if whole
    words = phrase.split.reject { FILLER_WORDS.include?(_1) }
    stripped = Search::Synonyms.canonical(words.join(" "))
    return Set[stripped] if stripped
    words.map { Search::Synonyms.canonical(_1) || _1 }.to_set
  end

  # Lower-case words separated by single spaces, nothing else ("Drum-Kit (own)" => "drum kit own").
  def self.normalize_phrase(text)
    text.to_s.downcase.split(/[^[:alnum:]]+/).reject(&:empty?).join(" ")
  end

  # Whether two names mean the same thing: all the words of the shorter one appear in the other.
  def self.same_role?(a, b)
    left = role_tokens(a)
    right = role_tokens(b)
    return false if left.empty? || right.empty?
    left.subset?(right) || right.subset?(left)
  end

  # Every two-way vocabulary spelling that role_tokens could look up (already in normalised form),
  # with its canonical term: the lookup table UrgentMatcher::Query ships to the database. Loaded
  # once per process, like the vocabulary itself.
  def self.vocabulary
    @vocabulary ||= Search::Synonyms.entries.reject { _1.kind == "city" }.flat_map(&:terms).uniq
      .filter_map { |term| [term, Search::Synonyms.canonical(term)] if term == normalize_phrase(term) }
      .to_h.freeze
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

  # Three queries whatever the volume: the ranking statement, then the users and profiles it chose.
  def ranked_candidates
    rows = query.top(UrgentConfig.candidate_limit)
    users = User.includes(:profile).where(id: rows.map { _1["id"] }).index_by(&:id)
    rows.filter_map { |row| (user = users[row["id"]]) && candidate(user, row) }
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

  def query = @query ||= Query.new(@request)

  # One person's score outside the ranked pass (the admin notifying someone by hand): the same SQL
  # for just them, with no city or account filter. nil when their availability blocks the request's
  # time or nothing about them matches it, exactly as the ranked pass would have left them out.
  def score(user)
    row = query.rows_for([user.id]).first
    return nil unless row && query.accept?(row)
    candidate(user, row)
  end

  # The Candidate for one ranked row: its points, and the reasons the hirer and admin see, worded
  # from the boolean signals in the order the weights are listed (the first three).
  def candidate(user, row)
    reasons = []
    reasons << "Plays #{@request.role_name}" if row["role_match"]
    reasons << "Plays #{@request.instrument}" if row["instrument_match"] && !row["role_match"]
    reasons << "In #{@request.city}" if row["city_match"]
    reasons << "Verified" if row["verified"]
    reasons << "Active in the last #{UrgentConfig.recent_activity_within_days} days" if row["active_recently"]
    reasons << "Available on #{IndianFormat.date_time(@request.start_at).split(',').first}" if row["available"]
    Candidate.new(user:, score: row["points"].to_i, reasons: reasons.first(3))
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
