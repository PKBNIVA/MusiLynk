require "test_helper"
require "minitest/mock"

# Settings: the one loader for the business-settings files under config/, with boot validation.
class SettingsTest < ActiveSupport::TestCase
  teardown { Settings.reload! }

  test "every shipped settings file parses and matches its schema" do
    assert Settings.validate_all!
    Settings::FILES.each_key { |name| assert_empty Settings.errors_for(name), name.to_s }
  end

  test "env-scoped files are read for the current environment with symbol keys" do
    assert_equal 1, Settings.load(:bookings)[:policy_version]
    assert_equal 18, Settings.load(:bookings)[:gst_percent]
    assert_equal "anthropic", Settings.load(:ai_pricing)[:provider], "the test section overrides default"
  end

  test "flat files are read whole, with string keys on request" do
    assert_equal "Mumbai", Settings.load(:seo_pages, symbolize: false).fetch("cities").fetch("mumbai")
    assert_equal "Mumbai", Settings.load(:seo_pages)[:cities][:mumbai]
    assert_equal 2499, Settings.load(:plans)[:plans][:pro][:monthly]
  end

  test "a file is read once and reload! forgets it" do
    first = Settings.load(:limits)
    assert_same first, Settings.load(:limits)
    Settings.reload!(:limits)
    assert_not_same first, Settings.load(:limits)
  end

  test "an unknown file name is refused" do
    assert_raises(ArgumentError) { Settings.load(:nope) }
  end

  test "a missing or mistyped key is reported with its name" do
    bad = Settings.load(:bookings).except(:gst_percent).merge(platform_fee_percent: "ten")
    Settings.stub(:load, bad) do
      errors = Settings.errors_for(:bookings)
      assert_includes errors, "bookings.yml: `platform_fee_percent` must be Numeric, got \"ten\""
      assert_includes errors, "bookings.yml: `gst_percent` is missing"
    end
  end

  test "a fee outside 0..100 or a negative refund window fails validation" do
    bad = Settings.load(:bookings).deep_dup
    bad[:platform_fee_percent] = 140
    bad[:cancellation][:partial_refund_percent] = -5
    Settings.stub(:load, bad) do
      error = assert_raises(Settings::Invalid) { Settings.validate!(:bookings) }
      assert_match(/platform_fee_percent/, error.message)
      assert_match(/partial_refund_percent/, error.message)
    end
  end

  test "a plan must carry every field and a code equal to its key" do
    bad = { plans: { pro: { code: "studio", name: "Pro", monthly: 1, annual: 1, trial_days: 0, active_posts: 1, seats: 1, shortlist: 1 } } }
    Settings.stub(:load, bad) do
      errors = Settings.errors_for(:plans)
      assert_includes errors, "plans.yml: plan `pro`: `bookings` is missing"
      assert_includes errors, "plans.yml: plan `pro`: `code` must equal its key"
    end
  end

  test "limits must all be positive integers" do
    bad = Settings.load(:limits).deep_dup
    bad[:paging][:list_page_size] = 0
    bad[:auth][:max_live_sessions] = "ten"
    Settings.stub(:load, bad) do
      errors = Settings.errors_for(:limits)
      assert_includes errors, "limits.yml: `paging.list_page_size` must be a positive integer, got 0"
      assert_includes errors, "limits.yml: `auth.max_live_sessions` must be a positive integer, got \"ten\""
    end
  end

  test "a feature flag needs a boolean enabled, a percentage in 0..100 and a list allowlist" do
    bad = { flags: { stage: { enabled: "yes", percentage: 250, allowlist: "me" }, "Bad-Name": { enabled: true } } }
    Settings.stub(:load, bad) do
      errors = Settings.errors_for(:features)
      assert_includes errors, "features.yml: flag `stage`: `enabled` must be TrueClass or FalseClass, got \"yes\""
      assert_includes errors, "features.yml: flag `stage`: `percentage` must be a number in 0..100, got 250"
      assert_includes errors, "features.yml: flag `stage`: `allowlist` must be a list"
      assert_includes errors, "features.yml: flag `Bad-Name` must be lower_snake_case"
    end
  end

  test "validate_all! names every broken file" do
    Settings.stub(:load, {}) do
      error = assert_raises(Settings::Invalid) { Settings.validate_all! }
      Settings::FILES.each_key { |name| assert_match(/#{name}\.yml/, error.message) }
    end
  end

  test "the domain readers read through Settings" do
    assert_equal Settings.load(:plans)[:plans].keys.map(&:to_s), PlanCatalog.codes
    assert_equal Settings.load(:limits)[:auth][:max_live_sessions], Limits.max_live_sessions
    assert_equal Settings.load(:catalog)[:act_types].map(&:to_s), Catalog.act_types
    assert_equal Settings.load(:bookings)[:gst_percent].to_f, BookingFeePolicy.gst_percent
  end
end
