# The signed-in user's own data rights: download a copy of their data, and delete
# their account (see AccountErasure for exactly what is removed and what is kept).
class AccountController < ApplicationController
  include UserRateLimit

  EXPORTS_PER_HOUR = 5
  DELETE_ATTEMPTS_PER_HOUR = 10

  before_action -> { authenticate! }

  # GET /api/account/export
  def export
    return unless within_user_rate_limit?("account-export", limit: EXPORTS_PER_HOUR, period: 1.hour)

    export = AccountExport.new(current_user)
    audit!("account.export", current_user)
    response.set_header("Content-Disposition", ActionDispatch::Http::ContentDisposition.format(disposition: "attachment", filename: export.filename))
    response.set_header("Cache-Control", "no-store")
    render json: export
  end

  # DELETE /api/account {confirmEmail}
  # The user types their own email address to confirm; this also stops a stray
  # request from an old tab deleting the account without the user seeing it.
  def destroy
    return unless within_user_rate_limit?("account-delete", limit: DELETE_ATTEMPTS_PER_HOUR, period: 1.hour)
    unless params[:confirmEmail].is_a?(String) && params[:confirmEmail].strip.casecmp?(current_user.email)
      return render_error("Type your account email exactly to confirm.", :unprocessable_content, "CONFIRMATION_MISMATCH")
    end

    erasure = AccountErasure.new(current_user)
    if (refusal = erasure.refusal)
      return render_error(refusal.message, :conflict, refusal.code)
    end

    audit!("account.delete", current_user)
    erasure.call!
    render json: { deleted: true }
  end
end
