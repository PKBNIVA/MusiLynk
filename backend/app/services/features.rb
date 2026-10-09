# Server-side feature flags (config/features.yml through Settings). A flag is on for a user when
# the env override says so, or when it is `enabled` and the user is allow-listed or falls inside
# the `percentage` bucket (a stable hash of flag name + user id, so one person always sees the
# same answer). Anonymous visitors get a flag only when it is on for everyone (percentage 100).
#
# FEATURE_<NAME>=false/0/off is the kill switch (off for everyone, including the allowlist);
# FEATURE_<NAME>=true/1/on turns it on for everyone. Any other value is ignored. See
# docs/ops/feature-flags.md.
module Features
  ON_VALUES = %w[true 1 on].freeze
  OFF_VALUES = %w[false 0 off].freeze

  module_function

  def definitions = Settings.load(:features).fetch(:flags)
  def names = definitions.keys.map(&:to_s)
  def known?(name) = definitions.key?(name.to_s.to_sym)

  def enabled?(name, user: nil)
    flag = definitions[name.to_s.to_sym] or return false
    override = env_override(name)
    return override unless override.nil?
    return false unless flag[:enabled] == true
    return true if user && allowlisted?(flag, user)

    percentage = flag.fetch(:percentage, 100).to_i
    return true if percentage >= 100
    return false if user.nil? || percentage <= 0

    bucket(name, user.id) < percentage
  end

  # 0..99, stable for a (flag, user id) pair across processes and deploys.
  def bucket(name, user_id) = Digest::SHA256.hexdigest("#{name}:#{user_id}")[0, 8].to_i(16) % 100

  # { "stage" => true, "resumes" => false }: every flag resolved for `user` (nil = anonymous).
  def for(user) = names.to_h { [_1, enabled?(_1, user:)] }

  # true / false, or nil when FEATURE_<NAME> is unset or unreadable.
  def env_override(name)
    value = ENV["FEATURE_#{name.to_s.upcase}"].to_s.strip.downcase
    return true if ON_VALUES.include?(value)
    return false if OFF_VALUES.include?(value)
    nil
  end

  def allowlisted?(flag, user)
    entries = Array(flag[:allowlist]).map { _1.to_s.strip.downcase }
    return false if entries.empty?
    entries.include?(user.id.to_s) || (user.respond_to?(:email) && user.email.present? && entries.include?(user.email.to_s.downcase))
  end
end
