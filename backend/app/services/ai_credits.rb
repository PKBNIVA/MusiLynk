require "zlib"

# The AI credits ledger: balance math, the monthly allowance grant, and race-safe charge/refund.
#
# Two pools make up an account's balance:
# - allowance: this calendar month's `monthly_allowance` grant, spent only by usage tagged to
#   this period. It never rolls over — an unspent allowance from a past period simply isn't
#   counted once the period filter moves on.
# - topup: `topup` and `admin_grant` credits, which persist (until `expires_at`, if any) across
#   periods. Usage draws allowance first, then topup, per AiCredits.charge!.
#
# Every account (a user, or an organization pooling a Studio subscription's credits — see
# AiCreditAccount) is serialized with a Postgres advisory transaction lock keyed off it, so a
# concurrent grant or spend against the same account can never race past the balance it read.
class AiCredits
  class InsufficientCredits < StandardError
    attr_reader :balance, :resets_at

    def initialize(balance:, resets_at:)
      @balance = balance
      @resets_at = resets_at
      super("Not enough AI credits.")
    end
  end

  def self.current_period(now = Time.current) = now.strftime("%Y-%m")

  def self.period_resets_at(now = Time.current) = (now.beginning_of_month + 1.month)

  def self.with_account_lock(account_type, account_id)
    key = Zlib.crc32("ai-credits:#{account_type}:#{account_id}")
    ActiveRecord::Base.transaction do
      ActiveRecord::Base.lease_connection.execute("SELECT pg_advisory_xact_lock(#{key})")
      yield
    end
  end

  # Grants this period's allowance for `resolution` if it hasn't been granted yet, idempotent
  # per account+period via the unique ledger index (belt-and-suspenders with the advisory lock).
  # Returns the grant amount (0 if already granted this period, or if the plan has no allowance,
  # e.g. Enterprise without Verse AI Plus).
  def self.ensure_monthly_allowance!(resolution, hirer:, email_verified: true, now: Time.current)
    amount = AiCreditAccount.monthly_allowance(resolution, hirer:, email_verified:)
    return 0 if amount.nil? || amount <= 0

    period = current_period(now)
    with_account_lock(resolution.account_type, resolution.account_id) do
      next 0 if AiCreditLedger.for_account(resolution.account_type, resolution.account_id).in_period(period).exists?(reason: "monthly_allowance")

      begin
        AiCreditLedger.create!(account_type: resolution.account_type, account_id: resolution.account_id, delta: amount,
          reason: "monthly_allowance", period:, created_at: now)
        amount
      rescue ActiveRecord::RecordNotUnique
        0
      end
    end
  end

  def self.balance(account_type, account_id, now: Time.current)
    allowance_pool(account_type, account_id, now:) + topup_pool(account_type, account_id, now:)
  end

  def self.allowance_pool(account_type, account_id, now: Time.current)
    period = current_period(now)
    rows = AiCreditLedger.for_account(account_type, account_id).in_period(period)
    granted = rows.where(reason: "monthly_allowance").sum(:delta)
    spent = rows.where(reason: %w[usage refund]).where("metadata->>'source' = 'allowance' OR metadata->>'source' IS NULL").sum(:delta)
    [granted + spent, 0].max
  end

  def self.topup_pool(account_type, account_id, now: Time.current)
    scope = AiCreditLedger.for_account(account_type, account_id).not_expired(now)
    granted = scope.where(reason: %w[topup admin_grant]).sum(:delta)
    spent = scope.where(reason: %w[usage refund]).where("metadata->>'source' = 'topup'").sum(:delta)
    [granted + spent, 0].max
  end

  # Charges `cost` credits from `resolution`'s account, allowance first then topup. Raises
  # InsufficientCredits (balance unchanged) when the account can't cover it. Returns the ledger
  # row(s) created, which `refund!` reverses on a provider error.
  def self.charge!(resolution, cost:, task:, tokens_in: nil, tokens_out: nil, cost_inr: 0, cached: false, batch: false, tier: "paid", now: Time.current)
    period = current_period(now)
    with_account_lock(resolution.account_type, resolution.account_id) do
      allowance_left = allowance_pool(resolution.account_type, resolution.account_id, now:)
      topup_left = topup_pool(resolution.account_type, resolution.account_id, now:)
      if allowance_left + topup_left < cost
        raise InsufficientCredits.new(balance: allowance_left + topup_left, resets_at: period_resets_at(now))
      end

      from_allowance = [allowance_left, cost].min
      from_topup = cost - from_allowance
      rows = []
      if from_allowance.positive?
        rows << AiCreditLedger.create!(account_type: resolution.account_type, account_id: resolution.account_id, delta: -from_allowance,
          reason: "usage", task: task.to_s, period:, tokens_in:, tokens_out:, cost_inr:, cached:, batch:,
          metadata: { "source" => "allowance", "tier" => tier }, created_at: now)
      end
      if from_topup.positive?
        rows << AiCreditLedger.create!(account_type: resolution.account_type, account_id: resolution.account_id, delta: -from_topup,
          reason: "usage", task: task.to_s, period:, tokens_in: from_allowance.positive? ? nil : tokens_in,
          tokens_out: from_allowance.positive? ? nil : tokens_out, cost_inr: from_allowance.positive? ? 0 : cost_inr,
          cached:, batch:, metadata: { "source" => "topup", "tier" => tier }, created_at: now)
      end
      rows
    end
  end

  # Reverses a charge (provider error or timeout after credits were already spent). Idempotent:
  # a ledger row is refunded at most once (guarded by metadata.refund_of).
  def self.refund!(ledger_rows, now: Time.current)
    Array(ledger_rows).each do |row|
      next if row.nil?

      with_account_lock(row.account_type, row.account_id) do
        next if AiCreditLedger.where("metadata->>'refund_of' = ?", row.id).exists?

        AiCreditLedger.create!(account_type: row.account_type, account_id: row.account_id, delta: -row.delta,
          reason: "refund", task: row.task, period: row.period, metadata: { refund_of: row.id, source: row.metadata["source"] },
          created_at: now)
      end
    end
  end
end
