module SyntheticQa
  class BatchCleanup
    Result = Data.define(:batch, :users_removed, :records_removed)

    # Every column that can hold a user id (foreign keys and loose references), by table. The purge
    # test walks the database and fails when a table with a foreign key to users is missing here, so a
    # new table cannot silently make a purge roll back or leave rows behind.
    HANDLED_USER_COLUMNS = {
      "act_members" => %w[user_id], "acts" => %w[owner_id], "ai_topup_payments" => %w[user_id], "application_events" => %w[actor_id],
      "applications" => %w[candidate_id], "audit_logs" => %w[actor_id entity_id], "auth_connections" => %w[owner_id],
      "availability_windows" => %w[user_id], "badges" => %w[user_id], "band_projects" => %w[owner_id], "billing_attempts" => %w[user_id],
      "billing_credits" => %w[user_id], "billing_events" => %w[user_id], "booking_payments" => %w[payer_id], "booking_quotes" => %w[created_by_id],
      "booking_requests" => %w[requester_id], "career_entries" => %w[user_id], "conversations" => %w[candidate_id employer_id],
      "crew_plans" => %w[owner_id], "email_tokens" => %w[user_id], "follows" => %w[follower_user_id followable_id],
      "job_alerts" => %w[user_id], "jobs" => %w[employer_id], "lifecycle_emails" => %w[user_id], "messages" => %w[sender_id],
      "notifications" => %w[user_id], "organization_members" => %w[user_id], "organizations" => %w[owner_id],
      "portfolio_items" => %w[user_id], "portfolios" => %w[owner_id], "post_comments" => %w[created_by_user_id author_id],
      "post_reactions" => %w[actor_id], "posts" => %w[created_by_user_id author_id], "product_events" => %w[user_id],
      "profiles" => %w[user_id], "promo_codes" => %w[created_by_id owner_user_id], "promo_redemptions" => %w[user_id],
      "recent_activities" => %w[user_id entity_id], "refund_records" => %w[requested_by_id decided_by_id], "reports" => %w[reporter_id resolved_by_id entity_id],
      "resumes" => %w[user_id], "review_prompts" => %w[user_id counterpart_user_id], "reviews" => %w[author_id employer_id],
      "saved_jobs" => %w[user_id], "sessions" => %w[user_id], "showcase_suggestions" => %w[owner_id], "subscriptions" => %w[user_id],
      "talent_folder_members" => %w[candidate_id], "talent_folders" => %w[owner_id], "talent_shortlists" => %w[candidate_id employer_id],
      "uploads" => %w[user_id], "urgent_request_notifications" => %w[user_id notified_by_admin_id], "urgent_request_responses" => %w[user_id],
      "urgent_requests" => %w[requester_id filled_by_id], "user_blocks" => %w[blocker_id blocked_id],
      "users" => %w[vouched_by_id], "verification_requests" => %w[user_id reviewed_by_id], "vouches" => %w[voucher_id vouchee_id]
    }.freeze

    def self.call(...) = new(...).call

    # authorized_by: an active admin may purge demo-* batches in any environment (admin demo-data UI).
    def initialize(batch:, authorized_by: nil)
      @batch = batch.to_s
      @authorized_by = authorized_by
      @counts = Hash.new(0)
    end

    def call
      guard!
      user_ids = User.synthetic(batch).pluck(:id)
      return Result.new(batch:, users_removed: 0, records_removed: 0) if user_ids.empty?

      ApplicationRecord.transaction do
        ids = collect_ids(user_ids)
        delete_relational_rows(user_ids, ids)
        delete_stage_rows(user_ids, ids)
        delete_owned_rows(user_ids, ids)
        delete_user_rows(user_ids, ids)
      end

      Result.new(batch:, users_removed: @counts.fetch("users", 0), records_removed: @counts.values.sum)
    end

    private

    attr_reader :batch, :authorized_by

    def guard!
      raise ArgumentError, "Invalid synthetic batch." unless batch.match?(/\A[a-z0-9][a-z0-9-]{2,63}\z/)
      if authorized_by
        raise SecurityError, "Only an active admin can delete demo data." unless authorized_by.admin? && authorized_by.active?
        raise ArgumentError, "Only demo-* batches can be deleted from the admin UI." unless Demo.batch?(batch)
      elsif !(Rails.env.test? || Rails.env.development? || ENV["ALLOW_SYNTHETIC_QA"] == "true")
        raise SecurityError, "Synthetic QA cleanup is disabled. Set ALLOW_SYNTHETIC_QA=true for an explicitly approved environment."
      end
    end

    def collect_ids(user_ids)
      job_ids = Job.where(employer_id: user_ids).pluck(:id)
      application_ids = Application.where(job_id: job_ids).or(Application.where(candidate_id: user_ids)).pluck(:id)
      act_ids = Act.where(owner_id: user_ids).pluck(:id)
      booking_ids = BookingRequest.where(act_id: act_ids).or(BookingRequest.where(requester_id: user_ids)).pluck(:id)
      quote_ids = BookingQuote.where(booking_request_id: booking_ids).or(BookingQuote.where(created_by_id: user_ids)).pluck(:id)
      payment_ids = BookingPayment.where(booking_request_id: booking_ids).or(BookingPayment.where(booking_quote_id: quote_ids)).or(BookingPayment.where(payer_id: user_ids)).pluck(:id)
      conversation_ids = Conversation.where(candidate_id: user_ids).or(Conversation.where(employer_id: user_ids)).or(Conversation.where(job_id: job_ids)).pluck(:id)
      organization_ids = Organization.where(owner_id: user_ids).pluck(:id)
      urgent_request_ids = UrgentRequest.where(requester_id: user_ids).pluck(:id)
      folder_ids = TalentFolder.where(owner_id: user_ids).pluck(:id)
      band_project_ids = BandProject.where(owner_id: user_ids).pluck(:id)
      crew_plan_ids = CrewPlan.where(owner_id: user_ids).pluck(:id)
      alert_ids = JobAlert.where(user_id: user_ids).pluck(:id)
      notification_ids = Notification.where(user_id: user_ids).pluck(:id)
      portfolio_item_ids = PortfolioItem.where(user_id: user_ids).pluck(:id)
      subscription_ids = Subscription.where(user_id: user_ids).pluck(:id)
      page_ids = user_ids + organization_ids + act_ids
      portfolio_ids = Portfolio.where(owner_id: page_ids).pluck(:id)
      post_ids = Post.where(created_by_user_id: user_ids).or(Post.where(author_id: page_ids)).pluck(:id)

      values = {
        jobs: job_ids, applications: application_ids, acts: act_ids, bookings: booking_ids, quotes: quote_ids, payments: payment_ids,
        conversations: conversation_ids, organizations: organization_ids, urgent_requests: urgent_request_ids,
        folders: folder_ids, band_projects: band_project_ids, crew_plans: crew_plan_ids, alerts: alert_ids,
        notifications: notification_ids, portfolios: portfolio_item_ids, portfolio_pages: portfolio_ids, subscriptions: subscription_ids,
        pages: page_ids, posts: post_ids
      }
      values[:all_entity_ids] = (user_ids + values.values.flatten).uniq
      values
    end

    def delete_relational_rows(user_ids, ids)
      remove(JobAlertDelivery.where(job_alert_id: ids[:alerts]).or(JobAlertDelivery.where(job_id: ids[:jobs])).or(JobAlertDelivery.where(notification_id: ids[:notifications])), "job_alert_deliveries")
      remove(ApplicationEvent.where(application_id: ids[:applications]).or(ApplicationEvent.where(actor_id: user_ids)), "application_events")
      remove(Message.where(conversation_id: ids[:conversations]).or(Message.where(sender_id: user_ids)), "messages")
      remove(Invoice.where(booking_payment_id: ids[:payments]), "invoices")
      remove(RefundRecord.where(booking_request_id: ids[:bookings]).or(RefundRecord.where(booking_payment_id: ids[:payments]))
        .or(RefundRecord.where(requested_by_id: user_ids)).or(RefundRecord.where(decided_by_id: user_ids)), "refund_records")
      remove(BookingPayment.where(id: ids[:payments]), "booking_payments")
      remove(BookingQuote.where(id: ids[:quotes]), "booking_quotes")
      remove(ActMember.where(act_id: ids[:acts]).or(ActMember.where(user_id: user_ids)), "act_members")
      remove(OrganizationMember.where(organization_id: ids[:organizations]).or(OrganizationMember.where(user_id: user_ids)), "organization_members")
      remove(UrgentRequestNotification.where(urgent_request_id: ids[:urgent_requests]).or(UrgentRequestNotification.where(user_id: user_ids))
        .or(UrgentRequestNotification.where(notified_by_admin_id: user_ids)), "urgent_request_notifications")
      remove(UrgentRequestResponse.where(urgent_request_id: ids[:urgent_requests]).or(UrgentRequestResponse.where(user_id: user_ids)), "urgent_request_responses")
      # A real hirer's request that a demo account "filled" stays, but no longer points at the demo account.
      released = UrgentRequest.where(filled_by_id: user_ids).where.not(id: ids[:urgent_requests])
      ids[:released_requests] = released.pluck(:id)
      @counts["urgent_requests_released"] += released.update_all(filled_by_id: nil, status: "closed")
      remove(TalentFolderMember.where(talent_folder_id: ids[:folders]).or(TalentFolderMember.where(candidate_id: user_ids)), "talent_folder_members")
      remove(TalentShortlist.where(employer_id: user_ids).or(TalentShortlist.where(candidate_id: user_ids)), "talent_shortlists")
      remove(SavedJob.where(user_id: user_ids).or(SavedJob.where(job_id: ids[:jobs])), "saved_jobs")
      remove(BandProjectRole.where(band_project_id: ids[:band_projects]).or(BandProjectRole.where(opportunity_id: ids[:jobs])), "band_project_roles")
      remove(CrewPlanRole.where(crew_plan_id: ids[:crew_plans]), "crew_plan_roles")
      remove(BillingReminder.where(subscription_id: ids[:subscriptions]), "billing_reminders")
      remove(PromoRedemption.where(user_id: user_ids).or(PromoRedemption.where(subscription_id: ids[:subscriptions])), "promo_redemptions")
      remove(BillingCredit.where(user_id: user_ids), "billing_credits")
      remove(ReviewPrompt.where(user_id: user_ids).or(ReviewPrompt.where(counterpart_user_id: user_ids))
        .or(ReviewPrompt.where(source_type: "urgent_request", source_id: ids[:urgent_requests])).or(ReviewPrompt.where(source_type: "booking_request", source_id: ids[:bookings])), "review_prompts")
      remove(AiBatchClassification.where(portfolio_item_id: ids[:portfolios]).or(AiBatchClassification.where(account_id: ids[:pages])), "ai_batch_classifications")
      remove(AiCreditLedger.where(account_id: ids[:pages]), "ai_credit_ledgers")
      remove(AiTopupPayment.where(user_id: user_ids), "ai_topup_payments")
      remove(ShowcaseSuggestion.where(owner_id: ids[:pages]).or(ShowcaseSuggestion.where(target_id: ids[:portfolio_pages] + ids[:portfolios] + ids[:pages]))
        .or(ShowcaseSuggestion.where(subject_id: ids[:portfolios])), "showcase_suggestions")
    end

    # The Stage: the demo people's posts, comments and reactions (and anyone's on those posts), the
    # follows they made or received, and the platform's own system posts that name them.
    def delete_stage_rows(user_ids, ids)
      remove(Follow.where(follower_user_id: user_ids).or(Follow.where(followable_id: ids[:pages])), "follows")
      remove(system_posts_naming(user_ids, ids), "system_posts")
      # Reactions and comments cascade with their post; the ones left are the demo people's on other posts.
      remove(PostReaction.where(post_id: ids[:posts]).or(PostReaction.where(actor_id: ids[:pages])), "post_reactions")
      remove(PostComment.where(post_id: ids[:posts]).or(PostComment.where(created_by_user_id: user_ids)).or(PostComment.where(author_id: ids[:pages])), "post_comments")
      remove(Post.where(id: ids[:posts]), "posts")
      remove(Badge.where(user_id: user_ids), "badges")
    end

    # Welcome and verified posts are keyed by user id, urgent-fill posts by request id (including a real
    # hirer's request a demo account filled, which is closed again, so "was filled" would be false); the weekly
    # leaderboard names people in its text. All are posted as the platform's "system" author.
    def system_posts_naming(user_ids, ids)
      refs = user_ids.flat_map { ["welcome:#{_1}", "verified:#{_1}"] } + (ids[:urgent_requests] + ids.fetch(:released_requests, [])).map { "urgent_filled:#{_1}" }
      names = User.where(id: user_ids).pluck(:name)
      scope = Post.where(author_type: "system", system_ref: refs)
      named = names.each_slice(200).map do |slice|
        pattern = slice.map { |name| "%#{ActiveRecord::Base.sanitize_sql_like(name)}%" }
        Post.where(author_type: "system", system_kind: "fastest_responders").where("posts.body ILIKE ANY (ARRAY[?])", pattern)
      end
      named.reduce(scope) { |memo, relation| memo.or(relation) }
    end

    def delete_owned_rows(user_ids, ids)
      remove(BookingRequest.where(id: ids[:bookings]), "booking_requests")
      remove(Conversation.where(id: ids[:conversations]), "conversations")
      remove(Application.where(id: ids[:applications]), "applications")
      remove(Report.where(reporter_id: user_ids).or(Report.where(resolved_by_id: user_ids)).or(Report.where(entity_id: ids[:all_entity_ids])), "reports")
      remove(Review.where(author_id: user_ids).or(Review.where(employer_id: user_ids)), "reviews")
      remove(VerificationRequest.where(user_id: user_ids).or(VerificationRequest.where(reviewed_by_id: user_ids)), "verification_requests")
      remove(Vouch.where(voucher_id: user_ids).or(Vouch.where(vouchee_id: user_ids)), "vouches")
      remove(AuditLog.where(actor_id: user_ids).or(AuditLog.where(entity_id: ids[:all_entity_ids])), "audit_logs")
      remove(BillingEvent.where(user_id: user_ids), "billing_events")
      remove(BillingAttempt.where(user_id: user_ids), "billing_attempts")
      remove(Job.where(id: ids[:jobs]), "jobs")
      remove(Act.where(id: ids[:acts]), "acts")
      remove(Organization.where(id: ids[:organizations]), "organizations")
      remove(UrgentRequest.where(id: ids[:urgent_requests]), "urgent_requests")
      remove(TalentFolder.where(id: ids[:folders]), "talent_folders")
      remove(BandProject.where(id: ids[:band_projects]), "band_projects")
      remove(CrewPlan.where(id: ids[:crew_plans]), "crew_plans")
    end

    def delete_user_rows(user_ids, ids)
      {
        "job_alerts" => JobAlert.where(user_id: user_ids), "portfolio_items" => PortfolioItem.where(user_id: user_ids),
        "portfolios" => Portfolio.where(id: ids[:portfolio_pages]), "resumes" => Resume.where(user_id: user_ids),
        "career_entries" => CareerEntry.where(user_id: user_ids), "user_blocks" => UserBlock.where(blocker_id: user_ids).or(UserBlock.where(blocked_id: user_ids)),
        "availability_windows" => AvailabilityWindow.where(user_id: user_ids), "lifecycle_emails" => LifecycleEmail.where(user_id: user_ids),
        "product_events" => ProductEvent.where(user_id: user_ids), "uploads" => Upload.where(user_id: user_ids),
        "auth_connections" => AuthConnection.where(owner_id: user_ids),
        "recent_activities" => RecentActivity.where(user_id: user_ids).or(RecentActivity.where(entity_id: user_ids)),
        "notifications" => Notification.where(user_id: user_ids), "subscriptions" => Subscription.where(user_id: user_ids),
        "email_tokens" => EmailToken.where(user_id: user_ids), "sessions" => Session.where(user_id: user_ids),
        "profiles" => Profile.where(user_id: user_ids)
      }.each { |name, relation| remove(relation, name) }
      remove(User.where(id: user_ids, synthetic_batch: batch), "users")
    end

    def remove(relation, name)
      @counts[name] += relation.delete_all
    end
  end
end
