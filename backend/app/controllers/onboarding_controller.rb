# POST /api/onboarding/starter — the two-minute sign-up's answers for an account created with an
# emailed code (the password sign-up sends them with POST /api/auth/register instead). Links
# already in the portfolio are skipped, so a retried request adds nothing twice.
class OnboardingController < ApplicationController
  before_action -> { authenticate!("jobseeker", "employer") }

  def starter
    return unless throttle!("onboarding-starter")
    starter = Onboarding::Starter.from_params(params)
    unless starter.valid?(current_user.role)
      return render_error(starter.errors.values.flatten.to_sentence, :unprocessable_content, "VALIDATION_FAILED", fields: starter.errors)
    end

    created = ApplicationRecord.transaction do
      # Consent given on the sign-up screen, for an account created before it was recorded.
      if current_user.consented_at.nil? && ActiveModel::Type::Boolean.new.cast(params[:consent]) == true
        current_user.update!(consented_at: Time.current)
      end
      starter.apply!(current_user)
    end
    audit!("onboarding.starter", current_user, { starter: created })
    render json: { user: public_user(current_user.reload), starter: created }
  end
end
