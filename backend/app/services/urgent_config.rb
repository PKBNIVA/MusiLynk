# Loads config/urgent.yml once per process (see AiPricing for the same pattern). Every
# number governing the "need someone by tomorrow" wedge — the response-time promise, how
# many candidates UrgentMatcher notifies, and quiet hours — lives here.
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
  def self.recent_activity_within = matcher.fetch(:recent_activity_within_days).days
  def self.no_response_after = config.fetch(:no_response_after_minutes).minutes
  def self.quiet_hours = config.fetch(:quiet_hours)

  # Whether `time` (default: now) falls inside the configured quiet-hours window in its
  # configured timezone. Used to decide whether an alert goes out immediately or waits.
  def self.within_alert_hours?(time = Time.current)
    zone = ActiveSupport::TimeZone[quiet_hours.fetch(:timezone)] || Time.zone
    local_hour = time.in_time_zone(zone).hour
    local_hour >= quiet_hours.fetch(:start_hour) && local_hour < quiet_hours.fetch(:end_hour)
  end
end
