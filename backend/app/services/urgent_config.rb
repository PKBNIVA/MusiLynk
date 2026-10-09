# Loads config/urgent.yml once per process (see AiPricing for the same pattern). Every
# number governing the "need someone by tomorrow" wedge — the response-time promise, how
# many candidates UrgentMatcher notifies, its scoring weights, and quiet hours — lives here.
# Update path: docs/ops/urgent-matching.md.
class UrgentConfig
  CONFIG_PATH = Rails.root.join("config/urgent.yml")

  def self.config
    @config ||= YAML.safe_load(File.read(CONFIG_PATH), aliases: true).fetch(Rails.env, {}).deep_symbolize_keys
  end

  def self.reload! = @config = nil

  def self.response_time_promise = config.fetch(:response_time_promise)
  def self.matcher = config.fetch(:matcher)
  def self.candidate_limit = matcher.fetch(:candidate_limit)
  def self.notify_count = matcher.fetch(:notify_count)
  def self.recent_activity_within_days = matcher.fetch(:recent_activity_within_days)
  def self.recent_activity_within = recent_activity_within_days.days
  # How long a request with no end time is taken to last, for the availability-window overlap.
  def self.default_duration = matcher.fetch(:default_duration_hours).hours
  # Points per scoring signal: role, instrument, city, verified, recent_activity, available.
  def self.weights = matcher.fetch(:weights)
  def self.weight(signal) = weights.fetch(signal)
  def self.no_response_after = config.fetch(:no_response_after_minutes).minutes
  def self.expire_after = config.fetch(:expire_after_hours).hours
  def self.quiet_hours = config.fetch(:quiet_hours)

  # Whether `time` (default: now) falls inside the configured quiet-hours window in its
  # configured timezone. Used to decide whether an alert goes out immediately or waits.
  def self.within_alert_hours?(time = Time.current)
    zone = ActiveSupport::TimeZone[quiet_hours.fetch(:timezone)] || Time.zone
    local_hour = time.in_time_zone(zone).hour
    local_hour >= quiet_hours.fetch(:start_hour) && local_hour < quiet_hours.fetch(:end_hour)
  end
end
