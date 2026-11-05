require "test_helper"
require "minitest/mock"

# Features: server-side flags with a master switch, a stable percentage rollout, an allowlist and
# an env kill switch (config/features.yml, docs/ops/feature-flags.md).
class FeaturesTest < ActiveSupport::TestCase
  User = Struct.new(:id, :email)

  def with_flags(flags, &block) = Features.stub(:definitions, flags, &block)

  def with_env(name, value)
    key = "FEATURE_#{name.to_s.upcase}"
    previous = ENV[key]
    value.nil? ? ENV.delete(key) : ENV[key] = value
    yield
  ensure
    previous.nil? ? ENV.delete(key) : ENV[key] = previous
  end

  test "the shipped flags resolve: stage on for everyone, resumes off" do
    assert Features.enabled?(:stage)
    assert_not Features.enabled?(:resumes)
    assert_equal({ "stage" => true, "resumes" => false }, Features.for(nil))
    assert_equal({ "stage" => true, "resumes" => false }, Features.for(User.new(7, "a@example.com")))
  end

  test "an unknown flag is off, never an error" do
    assert_not Features.enabled?(:nope, user: User.new(1, nil))
    assert_not Features.known?(:nope)
  end

  test "enabled: false is off for everyone, allowlist included" do
    with_flags({ beta: { enabled: false, percentage: 100, allowlist: [1] } }) do
      assert_not Features.enabled?(:beta)
      assert_not Features.enabled?(:beta, user: User.new(1, nil))
    end
  end

  test "the percentage bucket is a stable function of flag and user id" do
    with_flags({ beta: { enabled: true, percentage: 50, allowlist: [] } }) do
      user = User.new(12_345, nil)
      first = Features.enabled?(:beta, user:)
      100.times { assert_equal first, Features.enabled?(:beta, user:) }
      assert_equal Features.bucket(:beta, 12_345) < 50, first
    end
    assert_equal Features.bucket(:beta, 42), Features.bucket("beta", "42"), "ids compare as strings"
    assert_not_equal Features.bucket(:beta, 42), Features.bucket(:other, 42), "different flags bucket independently"
  end

  test "roughly the configured share of users is inside the bucket" do
    with_flags({ beta: { enabled: true, percentage: 30, allowlist: [] } }) do
      on = (1..2000).count { Features.enabled?(:beta, user: User.new(_1, nil)) }
      assert_in_delta 600, on, 90, "about 30% of 2000 users"
    end
  end

  test "anonymous visitors only see a flag that is on for everyone" do
    with_flags({ beta: { enabled: true, percentage: 99, allowlist: [] }, full: { enabled: true, percentage: 100 } }) do
      assert_not Features.enabled?(:beta)
      assert Features.enabled?(:full)
      assert_equal({ "beta" => false, "full" => true }, Features.for(nil))
    end
  end

  test "percentage 0 is off for every signed-in user" do
    with_flags({ beta: { enabled: true, percentage: 0, allowlist: [] } }) do
      assert_not (1..200).any? { Features.enabled?(:beta, user: User.new(_1, nil)) }
    end
  end

  test "the allowlist admits a user by id or by email, whatever the percentage" do
    with_flags({ beta: { enabled: true, percentage: 0, allowlist: [99, "Owner@Example.com"] } }) do
      assert Features.enabled?(:beta, user: User.new(99, nil))
      assert Features.enabled?(:beta, user: User.new(5, "owner@example.com"))
      assert_not Features.enabled?(:beta, user: User.new(5, "other@example.com"))
      assert_not Features.enabled?(:beta), "no anonymous allowlist"
    end
  end

  test "FEATURE_<NAME>=false is the kill switch, beating enabled and the allowlist" do
    with_flags({ beta: { enabled: true, percentage: 100, allowlist: [1] } }) do
      %w[false 0 off FALSE].each do |value|
        with_env(:beta, value) do
          assert_not Features.enabled?(:beta), value
          assert_not Features.enabled?(:beta, user: User.new(1, nil)), value
        end
      end
    end
  end

  test "FEATURE_<NAME>=true turns a flag on for everyone; other values are ignored" do
    with_flags({ beta: { enabled: false, percentage: 0, allowlist: [] } }) do
      %w[true 1 on].each { |value| with_env(:beta, value) { assert Features.enabled?(:beta), value } }
      with_env(:beta, "maybe") { assert_not Features.enabled?(:beta) }
      with_env(:beta, "") { assert_not Features.enabled?(:beta) }
    end
  end
end
