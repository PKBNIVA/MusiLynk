class AiTopupPayment < ApplicationRecord
  PACKS = %w[small large].freeze
  STATUSES = %w[created paid failed].freeze
  PROVIDERS = %w[internal razorpay].freeze

  belongs_to :user

  validates :pack, inclusion: { in: PACKS }
  validates :status, inclusion: { in: STATUSES }
  validates :provider, inclusion: { in: PROVIDERS }
  validates :amount, :credits, numericality: { only_integer: true, greater_than: 0 }

  # Credits the account once, idempotent on this row's own status: a payment already marked
  # paid is never credited twice, and locking the row serializes concurrent verify attempts.
  def credit!(now: Time.current)
    with_lock do
      return :already_paid if status == "paid"

      resolution = AiCreditAccount.for(user)
      AiCredits.with_account_lock(resolution.account_type, resolution.account_id) do
        AiCreditLedger.create!(account_type: resolution.account_type, account_id: resolution.account_id, delta: credits,
          reason: "topup", cost_inr: 0, expires_at: AiPricing.topups.fetch(:expires_after_months).months.from_now(now),
          metadata: { "topupPaymentId" => id, "pack" => pack }, created_at: now)
      end
      update!(status: "paid")
      :credited
    end
  end
end
