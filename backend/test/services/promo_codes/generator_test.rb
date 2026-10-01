require "test_helper"
require "minitest/mock"

class PromoCodesGeneratorTest < ActiveSupport::TestCase
  ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".freeze

  test "the configured format renders VERSE-XXXXXX from the unambiguous alphabet" do
    50.times do
      code = PromoCodes::Generator.render
      assert_match(/\AVERSE-[#{ALPHABET}]{6}\z/, code)
      assert_no_match(/[01OI]/, code.delete_prefix("VERSE-"))
    end
  end

  test "billing.yml carries the generator settings" do
    assert_equal "VERSE-{6}", BillingConfig.code_format
    assert_equal ALPHABET, BillingConfig.code_alphabet
  end

  test "custom formats mix literals, random runs and name letters padded with X" do
    assert_match(/\AX-[AB]{3}\z/, PromoCodes::Generator.render(format: "X-{3}", alphabet: "AB"))
    assert_match(/\AVERSE-AN[X]{2}[#{ALPHABET}]{4}\z/, PromoCodes::Generator.render(format: PromoCodes::Generator::REFERRAL_FORMAT, name: "An"))
    assert_match(/\AVERSE-PRIY[#{ALPHABET}]{4}\z/, PromoCodes::Generator.render(format: PromoCodes::Generator::REFERRAL_FORMAT, name: "Priya Sharma"))
    assert_match(/\AVERSE-JOSE/, PromoCodes::Generator.render(format: PromoCodes::Generator::REFERRAL_FORMAT, name: "José 99"))
    assert_match(/\AVERSE-XXXX/, PromoCodes::Generator.render(format: PromoCodes::Generator::REFERRAL_FORMAT, name: "1234"))
  end

  test "bad tokens and alphabets are refused" do
    assert_raises(ArgumentError) { PromoCodes::Generator.render(format: "{0}") }
    assert_raises(ArgumentError) { PromoCodes::Generator.render(format: "{33}") }
    assert_raises(ArgumentError) { PromoCodes::Generator.render(alphabet: "A") }
  end

  test "a colliding candidate is skipped and another drawn" do
    PromoCode.create!(code: "TAKEN-A", kind: "early_access")
    draws = %w[TAKEN-A TAKEN-A TAKEN-B].each
    PromoCodes::Generator.stub(:render, ->(**) { draws.next }) do
      assert_equal "TAKEN-B", PromoCodes::Generator.unique_code
    end
  end

  test "running out of unused codes raises Exhausted" do
    PromoCode.create!(code: "ONLY-ONE", kind: "early_access")
    PromoCodes::Generator.stub(:render, ->(**) { "ONLY-ONE" }) do
      assert_raises(PromoCodes::Generator::Exhausted) { PromoCodes::Generator.unique_code }
    end
  end

  test "create_batch makes N distinct stored-upper-case codes" do
    codes = PromoCodes::Generator.create_batch({ kind: "early_access", batch_id: "b1" }, 25)
    assert_equal 25, codes.map(&:code).uniq.size
    assert(codes.all? { _1.code == _1.code.upcase && _1.batch_id == "b1" })
  end

  test "a batch insert that loses a race retries with a fresh code" do
    calls = 0
    original = PromoCode.method(:create!)
    PromoCode.stub(:create!, lambda { |attrs|
      calls += 1
      raise ActiveRecord::RecordNotUnique, "race" if calls == 1

      original.call(attrs)
    }) do
      assert_equal 1, PromoCodes::Generator.create_batch({ kind: "early_access" }, 1).size
    end
    assert_equal 2, calls
  end

  test "referral_for issues one code per user, lazily, then reuses it" do
    user = User.create!(name: "Meera Iyer", email: "meera-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "employer", status: "active")
    first = PromoCodes::Generator.referral_for(user)
    assert_equal "referral", first.kind
    assert_equal user.id, first.owner_user_id
    assert_match(/\AVERSE-MEER[#{ALPHABET}]{4}\z/, first.code)
    assert_equal first, PromoCodes::Generator.referral_for(user)
    assert_equal 1, PromoCode.where(owner_user_id: user.id).count
  end
end
