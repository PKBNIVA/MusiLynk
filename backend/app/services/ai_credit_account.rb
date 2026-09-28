# Resolves which ledger account (a user or, when pooled, an organization) a user's AI credits
# spend against, and what monthly allowance that account is entitled to.
#
# Subscriptions in this codebase belong to a user, not an organization (Subscription has no
# organization_id). Studio is the only plan meant to pool across a workspace/organization, so
# pooling is keyed off the user's organization membership: a Studio subscriber who owns or
# belongs to an organization pools credits on that organization; every other plan (including a
# Studio subscription held by a user with no organization) is a per-user account.
class AiCreditAccount
  Resolution = Struct.new(:account_type, :account_id, :plan_code, :ai_plus_active, keyword_init: true)

  def self.for(user)
    new(user).resolve
  end

  def initialize(user)
    @user = user
  end

  def resolve
    entitlements = Entitlements.for(@user)
    plan_code = entitlements.plan_code
    ai_plus_active = active_ai_plus?

    if plan_code == "studio" && (org = pooling_organization)
      Resolution.new(account_type: "organization", account_id: org.id, plan_code:, ai_plus_active:)
    else
      Resolution.new(account_type: "user", account_id: @user.id, plan_code:, ai_plus_active:)
    end
  end

  # Monthly allowance credits for this resolution: the higher of the account's plan allowance
  # and Verse AI Plus (they don't stack), falling back to the account's free-tier allowance.
  # Free-tier credits (no paid plan, no Verse AI Plus) require a verified email; unverified,
  # this returns 0 so nothing is granted until the address is confirmed.
  def self.monthly_allowance(resolution, hirer:, email_verified: true)
    allowances = AiPricing.allowances
    free_tier = !%w[pro studio enterprise].include?(resolution.plan_code) && !resolution.ai_plus_active
    return 0 if free_tier && !email_verified

    plan_allowance = case resolution.plan_code
    when "pro" then allowances.fetch(:pro)
    when "studio" then allowances.fetch(:studio)
    when "enterprise" then allowances.fetch(:enterprise)
    else
      hirer ? allowances.fetch(:hirer_free) : allowances.fetch(:talent_free)
    end
    ai_plus_allowance = resolution.ai_plus_active ? allowances.fetch(:ai_plus) : 0
    return nil if plan_allowance.nil? && ai_plus_allowance.zero? # enterprise, no AI Plus: custom/unlimited
    return plan_allowance if plan_allowance.nil? # enterprise with AI Plus still custom-and-at-least

    [plan_allowance, ai_plus_allowance].max
  end

  private

  def active_ai_plus?
    Subscription.where(user: @user, plan_code: AiPricing.ai_plus.fetch(:plan_code), status: %w[active trialing]).exists?
  end

  # The organization a Studio subscriber pools credits on: the one they own, or otherwise the
  # first one they are a member of. Deterministic ordering so the same account always resolves
  # to the same pool.
  def pooling_organization
    Organization.find_by(owner_id: @user.id) ||
      Organization.joins(:organization_members).where(organization_members: { user_id: @user.id }).order(:created_at).first
  end
end
