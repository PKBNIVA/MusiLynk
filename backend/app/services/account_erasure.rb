# Erases a user's personal data when they delete their account, and keeps only what
# other people or the law still need:
#
# - Removed: profile, portfolio and uploaded files, sessions, sign-in tokens, saved jobs,
#   job alerts, notifications, availability, recent activity, verification evidence,
#   applications, reviews written by or about the user, shortlists, talent folders,
#   memberships, urgent-request responses and blocks.
# - Kept but anonymised: the user row itself (name "Deleted account", an unusable
#   email and password, status "deleted"), messages already sent to other people,
#   reports the user filed, jobs, acts and requests they posted (closed or cancelled),
#   and billing records, which Indian tax rules require us to keep.
#
# Deletion is refused while money or a counterpart depends on the account: an active
# subscription or an open booking must be cancelled or finished first.
class AccountErasure
  class Refused < StandardError
    attr_reader :code

    def initialize(message, code)
      super(message)
      @code = code
    end
  end

  DELETED_NAME = "Deleted account".freeze
  OPEN_SUBSCRIPTION_STATUSES = %w[pending trialing active past_due].freeze
  CLOSED_BOOKING_STATUSES = %w[completed declined cancelled].freeze

  def initialize(user)
    @user = user
  end

  def refusal
    if @user.admin?
      Refused.new("Admin accounts cannot be deleted here. Ask another admin to remove the admin role first.", "ADMIN_ACCOUNT")
    elsif Subscription.where(user: @user, status: OPEN_SUBSCRIPTION_STATUSES).exists?
      Refused.new("Cancel your paid plan on the Plan & billing page before deleting your account.", "SUBSCRIPTION_ACTIVE")
    elsif open_bookings.exists?
      Refused.new("Finish or cancel your open bookings before deleting your account.", "BOOKINGS_OPEN")
    end
  end

  def call!
    raise refusal if refusal

    uploads = Upload.where(user: @user).to_a
    ActiveRecord::Base.transaction do
      @user.lock!
      erase_owned_rows
      retire_public_listings
      anonymise_user
    end
    # Stored files go after the rows commit, so a storage error can never leave a
    # half-erased account; a failed object delete leaves an orphan the upload sweep removes.
    uploads.each do |upload|
      upload.purge!
    rescue StandardError => e
      ErrorReporter.capture(e, tags: { during: "account_erasure" }, upload_id: upload.id)
    end
    @user
  end

  private

  def open_bookings
    BookingRequest.where(requester: @user).or(BookingRequest.where(act_id: Act.where(owner: @user).select(:id)))
      .where.not(status: CLOSED_BOOKING_STATUSES)
  end

  def erase_owned_rows
    id = @user.id
    @user.sessions.delete_all
    @user.email_tokens.delete_all
    SignInCode.where(email: @user.email).delete_all
    @user.saved_jobs.delete_all
    @user.job_alerts.destroy_all
    @user.notifications.delete_all
    @user.availability_windows.delete_all
    @user.recent_activities.delete_all
    @user.verification_requests.delete_all
    @user.applications.destroy_all
    @user.portfolio_items.delete_all
    @user.talent_folders.destroy_all
    Review.where(author_id: id).or(Review.where(employer_id: id)).delete_all
    TalentShortlist.where(employer_id: id).or(TalentShortlist.where(candidate_id: id)).delete_all
    TalentFolderMember.where(candidate_id: id).delete_all
    ActMember.where(user_id: id).delete_all
    OrganizationMember.where(user_id: id).delete_all
    UrgentRequestResponse.where(user_id: id).delete_all
    UserBlock.where(blocker_id: id).or(UserBlock.where(blocked_id: id)).delete_all
    @user.profile&.destroy!
  end

  def retire_public_listings
    @user.jobs.where.not(status: "closed").update_all(status: "closed", updated_at: Time.current)
    @user.owned_acts.update_all(status: "inactive", updated_at: Time.current)
    @user.urgent_requests.where(status: "open").update_all(status: "cancelled", updated_at: Time.current)
  end

  def anonymise_user
    @user.update_columns(
      name: DELETED_NAME,
      email: "deleted-#{@user.id.to_s.downcase.gsub(/[^a-z0-9]/, "")}@deleted.invalid",
      password_digest: BCrypt::Password.create(SecureRandom.hex(32)),
      status: "deleted",
      profile_complete: false,
      email_verified: false,
      last_login_at: nil,
      updated_at: Time.current
    )
  end
end
