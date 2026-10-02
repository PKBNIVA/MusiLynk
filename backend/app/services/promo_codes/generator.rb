module PromoCodes
  # Turns a format string into a code. `{N}` is N random characters from an unambiguous
  # alphabet (BillingConfig.code_alphabet); `{NAMEN}` is the first N letters of a person's name,
  # upper-cased and padded with X (used for referral codes: "MUSILYNK-{NAME4}{4}").
  class Generator
    REFERRAL_FORMAT = "MUSILYNK-{NAME4}{4}".freeze
    TOKEN = /\{(NAME)?(\d+)\}/
    MAX_ATTEMPTS = 12

    class Exhausted < StandardError; end

    # One candidate code (not checked for collisions).
    def self.render(format: BillingConfig.code_format, alphabet: BillingConfig.code_alphabet, name: nil)
      raise ArgumentError, "the alphabet needs at least 2 characters" if alphabet.to_s.chars.uniq.size < 2

      letters = I18n.transliterate(name.to_s).upcase.gsub(/[^A-Z]/, "")
      format.gsub(TOKEN) do
        length = Regexp.last_match(2).to_i
        raise ArgumentError, "token length must be 1-32" unless length.between?(1, 32)

        if Regexp.last_match(1)
          letters.first(length).ljust(length, "X")
        else
          Array.new(length) { alphabet[SecureRandom.random_number(alphabet.length)] }.join
        end
      end
    end

    # A code not yet taken, retrying on collision.
    def self.unique_code(**options)
      MAX_ATTEMPTS.times do
        candidate = render(**options)
        return candidate unless PromoCode.exists?(code: candidate)
      end
      raise Exhausted, "Could not find an unused code; lengthen the format in config/billing.yml"
    end

    # Creates `count` codes sharing `attributes`, each with its own generated code. A collision
    # lost to a concurrent insert simply draws another code.
    def self.create_batch(attributes, count, **options)
      Array.new(count) { create_one(attributes, **options) }
    end

    def self.create_one(attributes, **options)
      attempts = 0
      begin
        PromoCode.create!(attributes.merge(code: unique_code(**options)))
      rescue ActiveRecord::RecordNotUnique
        attempts += 1
        retry if attempts < MAX_ATTEMPTS
        raise Exhausted, "Could not find an unused code"
      end
    end

    # The user's own referral code, issued the first time it is asked for.
    def self.referral_for(user)
      existing = PromoCode.find_by(owner_user_id: user.id, kind: "referral")
      return existing if existing

      create_one({ kind: "referral", owner_user_id: user.id, notes: "Referral code" }, format: REFERRAL_FORMAT, name: user.name)
    rescue ActiveRecord::RecordNotUnique
      PromoCode.find_by!(owner_user_id: user.id, kind: "referral")
    end
  end
end
