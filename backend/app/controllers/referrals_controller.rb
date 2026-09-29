# GET /api/me/referral-code: the signed-in user's own referral code, issued the first time it
# is asked for (PromoCodes::Generator.referral_for), plus how it is doing.
class ReferralsController < ApplicationController
  def show
    return unless authenticate!("jobseeker", "employer")
    return render_error("Referrals are turned off.", :not_found, "REFERRALS_OFF") unless BillingConfig.referral_enabled?

    promo = PromoCodes::Generator.referral_for(current_user)
    render json: { code: promo.code, shareUrl: "#{FrontendUrl.base}/pricing?code=#{CGI.escape(promo.code)}", redemptions: promo.redemptions_count,
                   rewardsEarned: BillingCredit.where(user: current_user, reason: "referral_reward").count,
                   refereePercentOff: BillingConfig.referral[:referee_percent_off] }
  end
end
