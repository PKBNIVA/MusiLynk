# Builds a machine-readable copy of everything Verse holds about one user, for the
# "Download my data" button. Secrets (password and token digests, provider
# signatures) and other people's private details are never included; for
# conversations, the other side appears only by the name the user already sees.
class AccountExport
  FORMAT_VERSION = 1
  SECRET_COLUMNS = %w[password_digest token_digest code_digest signature razorpay_signature].freeze
  # Moderators' private notes about a request are not the person's own data.
  INTERNAL_COLUMNS = %w[founder_notes].freeze

  def initialize(user)
    @user = user
  end

  def as_json(*)
    {
      format: "verse-account-export",
      version: FORMAT_VERSION,
      exportedAt: Time.current.iso8601,
      account: row(@user).except("synthetic_batch"),
      profile: @user.profile && row(@user.profile),
      portfolio: rows(@user.portfolio_items.order(:sort_order, :created_at)),
      portfolios: rows(Portfolio.where(owner_type: "user", owner_id: @user.id).order(:created_at)),
      careerEntries: rows(@user.career_entries.order(:kind, :position, :created_at)),
      resumes: rows(@user.resumes.order(:created_at)),
      uploads: Upload.where(user: @user).order(:created_at).map { _1.slice(:id, :filename, :content_type, :byte_size, :public_url, :status, :created_at) },
      applications: @user.applications.includes(:job).order(:created_at).map { |application|
        row(application).merge("job" => application.job.slice(:id, :title, :company, :location))
      },
      savedJobs: @user.saved_jobs.includes(:job).order(:created_at).map { { "jobId" => _1.job_id, "title" => _1.job.title, "savedAt" => _1.created_at } },
      jobAlerts: rows(@user.job_alerts.order(:created_at)),
      jobsPosted: rows(@user.jobs.order(:created_at)),
      conversations: conversations,
      notifications: rows(@user.notifications.order(:created_at)),
      reviewsWritten: rows(@user.reviews.order(:created_at)),
      reportsFiled: rows(@user.reports.order(:created_at)),
      verificationRequests: rows(@user.verification_requests.order(:created_at)),
      availability: rows(@user.availability_windows.order(:created_at)),
      acts: rows(@user.owned_acts.order(:created_at)),
      bookingRequests: rows(@user.booking_requests.order(:created_at)),
      organizations: rows(@user.organizations.order(:created_at)),
      subscriptions: rows(@user.subscriptions.order(:created_at)),
      payments: rows(@user.billing_attempts.order(:created_at)),
      billingProfiles: rows(BillingProfile.where(user_id: @user.id).order(:version)),
      invoices: TaxInvoice.where(user_id: @user.id).order(:issued_at).map { _1.document_json.stringify_keys },
      stagePosts: rows(Post.where(created_by_user_id: @user.id).order(:created_at)),
      stageComments: rows(PostComment.where(created_by_user_id: @user.id).order(:created_at)),
      stageFollows: rows(Follow.where(follower_user_id: @user.id).order(:created_at)),
      urgentRequests: @user.urgent_requests.order(:created_at).map { row(_1).except(*INTERNAL_COLUMNS) },
      urgentResponses: rows(UrgentRequestResponse.where(user_id: @user.id).order(:created_at)),
      shortlists: rows(TalentShortlist.where(employer_id: @user.id).order(:created_at)),
      talentFolders: rows(@user.talent_folders.order(:created_at)),
      vouches: @user.vouches.order(:created_at).map { row(_1).except("token") },
      bandProjects: rows(@user.band_projects.order(:created_at)),
      crewPlans: rows(@user.crew_plans.order(:created_at)),
      connectedAccounts: @user.auth_connections.order(:created_at).map { _1.slice(:provider, :email, :display_name, :created_at) },
      blockedUsers: @user.user_blocks.includes(:blocked).map { { "userId" => _1.blocked_id, "name" => _1.blocked.name, "since" => _1.created_at } }
    }
  end

  def filename = "verse-data-#{Time.current.strftime('%Y-%m-%d')}.json"

  private

  def conversations
    Conversation.where(candidate: @user).or(Conversation.where(employer: @user))
      .includes(:candidate, :employer, :messages).order(:created_at).map do |conversation|
      other = conversation.candidate_id == @user.id ? conversation.employer : conversation.candidate
      {
        "id" => conversation.id,
        "with" => other.name,
        "jobId" => conversation.job_id,
        "startedAt" => conversation.created_at,
        "messages" => conversation.messages.sort_by(&:created_at).map do |message|
          { "from" => message.sender_id == @user.id ? "you" : other.name, "body" => message.body, "sentAt" => message.created_at }
        end
      }
    end
  end

  def rows(scope) = scope.map { row(_1) }

  def row(record) = record.attributes.except(*SECRET_COLUMNS)
end
