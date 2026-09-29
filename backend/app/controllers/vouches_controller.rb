# Vouching: a verified musician refers someone they've worked with by email, no money
# involved. See Vouch (the cap and verified-only rule live there as validations) and
# Admin::VerificationsController#update (sorts vouched applicants first, promotes on approval).
class VouchesController < ApplicationController
  before_action -> { authenticate!("jobseeker", "employer") }

  def index
    render json: { vouches: current_user.vouches.order(created_at: :desc).map(&:api_json) }
  end

  def create
    return render_error("Only a verified musician can vouch for someone.", :forbidden, "NOT_VERIFIED") unless current_user.profile&.verified?
    email = params[:email].to_s.strip
    return render_error("Enter an email address.", :unprocessable_content) if email.blank?

    vouch = Vouch.new(voucher: current_user, vouchee_email: email)
    unless vouch.save
      return render_error(vouch.errors.full_messages.to_sentence, :unprocessable_content, "VALIDATION_FAILED", fields: vouch.errors.to_hash(true))
    end

    join_link = "#{NotificationEmail.frontend_url}/join/musician?vouch=#{vouch.token}"
    Notifier.vouch_invite(vouch, join_link:)
    render json: { vouch: vouch.api_json }, status: :created
  end
end
