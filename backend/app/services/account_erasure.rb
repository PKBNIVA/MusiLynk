# Erases a user's personal data when they delete their account, and keeps only what
# other people or the law still need:
#
# - Removed: profile, portfolio and uploaded files, sessions, sign-in tokens, saved jobs,
#   job alerts, notifications, availability, recent activity, verification evidence,
#   applications, reviews written by or about the user, shortlists, talent folders,
#   memberships, urgent-request responses and blocks.
# - Showcase (see erase_showcase): personal portfolios, the career record, resumes and review
#   suggestions are removed. Portfolios owned by an organization or act stay with the Page.
# - Stage (The Stage community feed): follows the user made or received, and applause and
#   comments they gave as themselves, are removed; posts they made as themselves are
#   removed (which cascades their own reactions/comments and nulls out any reference to
#   them — a portfolio/job share or a reshare — the same way a deleted portfolio item, job
#   share or reshared post degrades to an "unavailable" preview instead of failing; see the
#   posts migrations and Post#shared_entity_preview). Posts they made as a Page they run (an
#   organization or an act) are NOT removed — that content belongs to the Page, not the
#   person — and keep `created_by_user_id` pointing at this row: the user row is anonymised
#   below, not deleted, so that foreign key stays valid throughout. Other people's posts that
#   lost one of this user's applause, comments or reshares have their counters recounted.
# - Kept but anonymised: the user row itself (name "Deleted account", an unusable
#   email and password, status "deleted"), messages already sent to other people,
#   reports the user filed, jobs, acts and requests they posted (closed or cancelled),
#   posts they made as a Page (see above), and billing records, which Indian tax rules
#   require us to keep.
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
      erase_showcase
      erase_owned_rows
      erase_stage_content
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
    @user.auth_connections.destroy_all
    SignInCode.where(email: @user.email).delete_all
    PhoneOtp.where(phone: @user.phone).delete_all if @user.phone
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
    erase_third_party_contact_details
    @user.band_projects.destroy_all
    @user.crew_plans.destroy_all
    UserBlock.where(blocker_id: id).or(UserBlock.where(blocked_id: id)).delete_all
    @user.profile&.destroy!
  end

  # Addresses and billing details this person held about others, or others held about them:
  # vouch invitations they sent are removed, invitations sent to their own address are
  # anonymised, and the tax id and billing address of workspaces they own are cleared.
  def erase_third_party_contact_details
    Vouch.where(voucher_id: @user.id).delete_all
    Vouch.where(vouchee_id: @user.id).or(Vouch.where(vouchee_email: @user.email)).find_each do |vouch|
      vouch.update_columns(vouchee_email: "deleted-#{vouch.id.to_s.downcase.gsub(/[^a-z0-9]/, "")}@deleted.invalid", vouchee_id: nil)
    end
    Organization.where(owner_id: @user.id).update_all(tax_id: nil, billing_email: nil, updated_at: Time.current)
  end

  # --- Showcase: portfolios, career record, resumes and suggestions -------------------------
  # Runs before erase_owned_rows deletes the work samples. Nothing references these rows by
  # foreign key except applications (portfolio_id/resume_id ON DELETE SET NULL), and those
  # applications are removed with the account anyway.
  def erase_showcase
    id = @user.id
    item_ids = @user.portfolio_items.select(:id)
    entry_ids = @user.career_entries.select(:id)
    ShowcaseSuggestion.where(owner_type: "user", owner_id: id)
      .or(ShowcaseSuggestion.where(subject_type: "portfolio_item", subject_id: item_ids))
      .or(ShowcaseSuggestion.where(subject_type: "career_entry", subject_id: entry_ids)).delete_all
    Portfolio.where(owner_type: "user", owner_id: id).delete_all
    @user.resumes.delete_all
    @user.career_entries.delete_all
  end
  # --- end Showcase ------------------------------------------------------------------------

  # Removes this person's own Stage activity (see the header). Posts, applause and comments
  # are gathered up front so the posts *other people* still have can be recounted afterwards —
  # once this user's rows are gone, there is nothing left to compute the old counts from.
  def erase_stage_content
    id = @user.id
    own_post_ids = Post.where(author_type: "user", author_id: id).pluck(:id)
    affected_post_ids = (
      PostReaction.where(actor_type: "user", actor_id: id).pluck(:post_id) +
      PostComment.where(created_by_user_id: id).pluck(:post_id) +
      Post.where(id: own_post_ids).where.not(reshared_post_id: nil).pluck(:reshared_post_id)
    ).uniq - own_post_ids

    Follow.where(follower_user_id: id).or(Follow.where(followable_type: "user", followable_id: id)).delete_all
    PostReaction.where(actor_type: "user", actor_id: id).delete_all
    PostComment.where(created_by_user_id: id).delete_all
    # Cascades that post's own reactions/comments, and nulls out shared_portfolio_item_id/
    # shared_job_id/reshared_post_id on any other post that pointed at it (see the migrations).
    Post.where(id: own_post_ids).delete_all

    recount_post_counters(affected_post_ids)
  end

  def recount_post_counters(post_ids)
    return if post_ids.empty?

    Post.where(id: post_ids).find_each do |post|
      post.update_columns(
        applause_count: PostReaction.where(post_id: post.id).count,
        comment_count: PostComment.where(post_id: post.id).where.not(status: "deleted").count,
        reshare_count: Post.where(reshared_post_id: post.id).count
      )
    end
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
      phone: nil,
      phone_verified_at: nil,
      updated_at: Time.current
    )
  end
end
