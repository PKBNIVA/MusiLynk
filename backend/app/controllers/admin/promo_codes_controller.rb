module Admin
  # Codes tab: promo, extended-trial and Early Access codes, and read-only visibility of the
  # user-owned referral codes. Referral programme settings live in config/billing.yml and are
  # only reported here.
  class PromoCodesController < BaseController
    include AdminPagination

    MAX_BATCH = 500
    CSV_LIMIT = 10_000
    CSV_HEADERS = %w[code kind percent_off duration_periods trial_days plan_codes intervals razorpay_offer_id max_redemptions redemptions_count
                     per_user_limit starts_at expires_at active batch_id notes].freeze
    # Fields an admin may change after creation.
    EDITABLE = %i[active expires_at max_redemptions notes razorpay_offer_id].freeze

    def index
      scope = PromoCode.order(created_at: :desc, id: :desc)
      scope = params[:kind].present? ? scope.where(kind: params[:kind].to_s) : scope.where.not(kind: "referral")
      scope = scope.where(active: params[:active].to_s == "true") if %w[true false].include?(params[:active].to_s)
      scope = scope.where(batch_id: params[:batchId].to_s) if params[:batchId].present?
      if params[:q].present?
        like = "%#{params[:q].to_s.strip.first(100).gsub(/[\\%_]/) { "\\#{_1}" }}%"
        scope = scope.where("promo_codes.code ILIKE :like OR promo_codes.notes ILIKE :like", like:)
      end
      rows, meta = admin_paginate(scope)
      render json: { codes: rows.map { serialize(_1) }, programme: programme }.merge(meta)
    end

    def create
      attributes = create_attributes
      unless PromoCode::ADMIN_KINDS.include?(attributes[:kind])
        return render_error("Choose a kind: #{PromoCode::ADMIN_KINDS.join(', ')}. Referral codes are issued to users automatically.", :unprocessable_content, "INVALID_KIND")
      end
      count = params[:generate]
      if count.present?
        count = count.to_s.match?(/\A\d+\z/) ? count.to_i : 0
        return render_error("Generate between 1 and #{MAX_BATCH} codes.", :unprocessable_content, "INVALID_BATCH") unless count.between?(1, MAX_BATCH)

        batch_id = "batch-#{Time.current.strftime('%Y%m%d')}-#{SecureRandom.hex(3)}"
        # Validate the shared settings once so a bad form fails before any row is written.
        probe = PromoCode.new(attributes.merge(code: "PROBE-1"))
        return render_error(probe.errors.full_messages.to_sentence, :unprocessable_content, "VALIDATION_FAILED") unless probe.valid?

        codes = PromoCode.transaction { PromoCodes::Generator.create_batch(attributes.merge(batch_id:), count) }
        audit!("admin.promo_code.generate", codes.first, count:, batchId: batch_id, kind: attributes[:kind])
        render json: { codes: codes.map { serialize(_1) }, batchId: batch_id }, status: :created
      else
        promo = PromoCode.new(attributes.merge(code: params[:code].to_s))
        return render_error(promo.errors.full_messages.to_sentence, :unprocessable_content, "VALIDATION_FAILED") unless promo.save

        audit!("admin.promo_code.create", promo, kind: promo.kind)
        render json: { code: serialize(promo) }, status: :created
      end
    rescue PromoCodes::Generator::Exhausted => error
      render_error(error.message, :conflict, "CODE_SPACE_EXHAUSTED")
    end

    def update
      promo = PromoCode.find(params[:id])
      changes = params.permit(*EDITABLE).to_h.symbolize_keys
      return render_error("Nothing to change.", :bad_request) if changes.empty?
      return render_error("A referral code's offer comes from the programme settings.", :unprocessable_content, "REFERRAL_READ_ONLY") if promo.kind == "referral" && changes.key?(:razorpay_offer_id)

      if promo.update(changes)
        audit!("admin.promo_code.update", promo, changes: changes.keys)
        render json: { code: serialize(promo) }
      else
        render_error(promo.errors.full_messages.to_sentence, :unprocessable_content, "VALIDATION_FAILED")
      end
    end

    def redemptions
      promo = PromoCode.find(params[:id])
      scope = promo.redemptions.includes(:user, :billing_credit).order(redeemed_at: :desc)
      rows, meta = admin_paginate(scope)
      render json: { redemptions: rows.map { redemption_json(_1) } }.merge(meta)
    end

    def export
      scope = PromoCode.order(:created_at, :id)
      scope = scope.where(batch_id: params[:batchId].to_s) if params[:batchId].present?
      scope = scope.where.not(kind: "referral") unless params[:kind] == "referral"
      audit!("admin.promo_code.export", nil, batchId: params[:batchId].presence, count: scope.count)
      csv = ([CSV_HEADERS] + scope.limit(CSV_LIMIT).map { csv_row(_1) }).map { csv_line(_1) }.join("\n") << "\n"
      send_data csv, type: "text/csv; charset=utf-8", disposition: "attachment", filename: "promo-codes#{"-#{params[:batchId]}" if params[:batchId].present?}.csv"
    end

    private

    def create_attributes
      permitted = params.permit(:kind, :percent_off, :percentOff, :duration_periods, :durationPeriods, :trial_days, :trialDays, :razorpay_offer_id, :razorpayOfferId,
        :max_redemptions, :maxRedemptions, :per_user_limit, :perUserLimit, :starts_at, :startsAt, :expires_at, :expiresAt, :notes,
        plan_codes: [], planCodes: [], intervals: [])
      pick = ->(snake, camel) { (permitted.key?(snake) ? permitted[snake] : permitted[camel]).presence }
      {
        kind: permitted[:kind].to_s, created_by: current_user,
        percent_off: pick.call(:percent_off, :percentOff), duration_periods: pick.call(:duration_periods, :durationPeriods),
        trial_days: pick.call(:trial_days, :trialDays), razorpay_offer_id: pick.call(:razorpay_offer_id, :razorpayOfferId),
        max_redemptions: pick.call(:max_redemptions, :maxRedemptions), per_user_limit: pick.call(:per_user_limit, :perUserLimit) || 1,
        starts_at: pick.call(:starts_at, :startsAt), expires_at: pick.call(:expires_at, :expiresAt),
        plan_codes: Array(permitted[:plan_codes] || permitted[:planCodes]), intervals: Array(permitted[:intervals]), notes: permitted[:notes]
      }
    end

    def programme
      referral = BillingConfig.referral
      { referral: { enabled: referral[:enabled], refereePercentOff: referral[:referee_percent_off], refereeDurationPeriods: referral[:referee_duration_periods],
                    referrerRewardDays: referral[:referrer_reward_days], referrerRewardCap: referral[:referrer_reward_cap], offerConfigured: BillingConfig.referral_offer_id.present? },
        codeFormat: BillingConfig.code_format, codeAlphabet: BillingConfig.code_alphabet,
        earlyAccess: { days: BillingConfig.early_access_days, seats: BillingConfig.early_access_seats, granted: EarlyAccessGrant.seats_taken },
        offerRequired: PromoCodes::Validator.offer_required?, editNote: "Referral programme settings are edited in backend/config/billing.yml." }
    end

    def serialize(promo)
      { id: promo.id, code: promo.code, kind: promo.kind, percentOff: promo.percent_off, durationPeriods: promo.duration_periods, trialDays: promo.trial_days,
        planCodes: promo.plan_codes, intervals: promo.intervals, razorpayOfferId: promo.razorpay_offer_id, maxRedemptions: promo.max_redemptions,
        redemptionsCount: promo.redemptions_count, perUserLimit: promo.per_user_limit, startsAt: promo.starts_at, expiresAt: promo.expires_at,
        active: promo.active, ownerUserId: promo.owner_user_id, createdById: promo.created_by_id, notes: promo.notes, batchId: promo.batch_id,
        needsOffer: promo.needs_offer?, createdAt: promo.created_at }
    end

    def redemption_json(redemption)
      credit = redemption.billing_credit
      { id: redemption.id, userId: redemption.user_id, name: redemption.user&.name, email: redemption.user&.email, subscriptionId: redemption.subscription_id,
        kind: redemption.kind, percentOff: redemption.percent_off, trialDays: redemption.trial_days, redeemedAt: redemption.redeemed_at,
        referrerReward: credit && { days: credit.days, appliedAt: credit.applied_at, userId: credit.user_id } }
    end

    # RFC 4180 quoting, written by hand: the csv gem stops being a default gem in Ruby 3.4.
    def csv_line(values) = values.map { "\"#{_1.to_s.gsub('"', '""')}\"" }.join(",")

    def csv_row(promo)
      CSV_HEADERS.map do |header|
        value = case header
        when "plan_codes", "intervals" then promo.public_send(header).join(" ")
        when "starts_at", "expires_at" then promo.public_send(header)&.iso8601
        else promo.public_send(header)
        end
        # A spreadsheet would run a cell that starts with = + - or @ as a formula.
        value.is_a?(String) && value.match?(/\A[=+\-@\t\r]/) ? "'#{value}" : value
      end
    end
  end
end
