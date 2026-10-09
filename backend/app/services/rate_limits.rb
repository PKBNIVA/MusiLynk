# config/rate_limits.yml, loaded once per process (same pattern as UrgentConfig). Every rate
# limit, the Turnstile switch and the 429 spike thresholds are read from here; nothing is
# written into a controller. See docs/security/rate-limits.md for the table and update path.
module RateLimits
  PATH = Rails.root.join("config/rate_limits.yml")
  UnknownBucket = Class.new(KeyError)

  module_function

  def data = @data ||= YAML.safe_load_file(PATH, aliases: true).fetch(Rails.env).deep_symbolize_keys.freeze

  def reload! = @data = nil

  def limits = data.fetch(:limits)

  def names = limits.keys.map(&:to_s)

  # The whole entry for a bucket name (string or symbol); raises UnknownBucket for a typo so a
  # misspelt bucket fails on the first request in test, never silently unlimited in production.
  def rule(name)
    limits.fetch(name.to_sym) { raise UnknownBucket, "config/rate_limits.yml has no limit named #{name.inspect}" }
  end

  def period(name) = rule(name).fetch(:period_seconds).to_i.seconds

  # Single-scope buckets have `limit`; failure budgets have `scopes: {scope => limit}`.
  def limit(name, scope = nil)
    entry = rule(name)
    return entry.fetch(:limit).to_i if scope.nil?
    entry.fetch(:scopes).fetch(scope.to_sym).to_i
  end

  def scopes(name) = rule(name).fetch(:scopes).transform_values(&:to_i)

  # Whether an unavailable cache store rejects (closed) or admits (open) requests on this bucket.
  def fail_closed?(name) = rule(name)[:fail].to_s == "closed"

  def turnstile = data.fetch(:turnstile)
  def turnstile_required?(name) = rule(name)[:turnstile] == true

  def spike_alert = data.fetch(:spike_alert)
  def spike_window = spike_alert.fetch(:window_seconds).to_i.seconds

  def spike_threshold(name)
    (spike_alert[:thresholds] || {}).fetch(name.to_sym, spike_alert.fetch(:threshold)).to_i
  end
end
