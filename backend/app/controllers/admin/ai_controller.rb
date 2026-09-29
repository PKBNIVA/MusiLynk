module Admin
  class AiController < BaseController
    # GET /api/admin/ai/costs — this month's spend by task and by tier, and the top accounts.
    def costs
      from, to = AiSpendGuard.month_bounds
      scope = AiCreditLedger.where(reason: "usage", created_at: from..to)
      by_task = scope.group(:task).sum(:cost_inr)
      by_tier = scope.group("metadata->>'tier'").sum(:cost_inr)
      top_accounts = scope.group(:account_type, :account_id).sum(:cost_inr).sort_by { -_2 }.first(20)
        .map { |(account_type, account_id), inr| { accountType: account_type, accountId: account_id, spendInr: inr } }

      render json: {
        provider: AiPricing.provider,
        model: AiAssist.model_name,
        enabled: AiAssist.enabled?,
        totalSpendInr: AiSpendGuard.total_spend_inr,
        freeTierSpendInr: AiSpendGuard.free_tier_spend_inr,
        freeTierBudgetInr: AiPricing.budgets.fetch(:free_tier_monthly_budget_inr),
        hardBudgetInr: AiPricing.budgets.fetch(:hard_monthly_budget_inr),
        byTask: by_task,
        byTier: by_tier,
        topAccounts: top_accounts
      }
    end

    # GET /api/admin/ai/usage?accountType=&accountId=
    def usage
      account_type = params[:accountType].to_s
      account_id = params[:accountId].to_s
      return render_error("accountType must be user or organization.", :bad_request) unless AiCreditLedger::ACCOUNT_TYPES.include?(account_type)

      resolution = AiCreditAccount::Resolution.new(account_type:, account_id:, plan_code: "free", ai_plus_active: false)
      render json: AiUsageReport.for(resolution)
    end

    # POST /api/admin/ai/grants { accountType, accountId, credits, reason? }
    def create_grant
      account_type = params[:accountType].to_s
      account_id = params[:accountId].to_s
      credits = params[:credits].to_i
      return render_error("accountType must be user or organization.", :bad_request) unless AiCreditLedger::ACCOUNT_TYPES.include?(account_type)
      return render_error("credits must be a positive integer.", :bad_request) unless credits.positive?

      row = AiCredits.with_account_lock(account_type, account_id) do
        AiCreditLedger.create!(account_type:, account_id:, delta: credits, reason: "admin_grant",
          metadata: { "grantedBy" => current_user.id, "note" => params[:note].to_s.first(500) }.compact)
      end
      audit!("admin.ai.grant", row, accountType: account_type, accountId: account_id, credits:)
      render json: { ok: true, ledgerEntry: row, balance: AiCredits.balance(account_type, account_id) }
    end
  end
end
