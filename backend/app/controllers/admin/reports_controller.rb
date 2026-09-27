module Admin
  class ReportsController < BaseController
    DECISIONS = %w[warn suspend dismiss].freeze
    EXCERPT_SIZE = 20
    HISTORY_WINDOW = 90.days
    NOTE_LIMIT = 1_000
    # Written by the conversation report flow at the end of `details` (after any text from the reporter).
    CONVERSATION_REFERENCE = /Reported from conversation (conv_[0-9a-f-]{36})\.?\s*\z/

    def index = render(json: { reports: Report.includes(:reporter).order(created_at: :desc).limit(500).map { _1.attributes.merge(reporterName: _1.reporter&.name) } })

    def update
      return render_error("Invalid report status.", :bad_request) unless %w[resolved dismissed].include?(params[:status])
      report = Report.find(params[:id]); report.update!(status: params[:status], resolved_by_id: current_user.id, resolved_at: Time.current); audit!("admin.report", report); render json: { ok: true }
    end

    # Everything a moderator needs to decide on one report: the reported user's history and, for a
    # report made from a conversation, the messages leading up to the report. Reading a private
    # conversation is audit-logged.
    def context
      report = Report.includes(:reporter).find(params[:id])
      target = target_user(report)
      conversation = reported_conversation(report, target)
      excerpt = conversation_excerpt(conversation, report)
      audit!("admin.report.context", report, conversationId: conversation&.id, messagesShown: excerpt ? excerpt[:messages].length : 0)
      render json: {
        report: serialize_report(report),
        reportedUser: target && { id: target.id, name: target.name, email: target.email, role: target.role, status: target.status, createdAt: target.created_at },
        history: target && history_for(target, report),
        conversation: excerpt,
        guidelinesUrl: "/community-guidelines"
      }
    end

    # Closes an open report with a recorded decision:
    #   warn    - the reported user gets an in-app notice pointing at the community guidelines
    #   suspend - the reported user is suspended and signed out everywhere (as from the Users tab)
    #   dismiss - no action against anyone
    def moderate
      decision = params[:decision]
      return render_error("Choose warn, suspend or dismiss.", :bad_request, "INVALID_DECISION") unless decision.is_a?(String) && DECISIONS.include?(decision)
      note = params[:note]
      return render_error("note must be text.", :unprocessable_content, "INVALID_NOTE") unless note.nil? || note.is_a?(String)
      note = note.to_s.strip
      return render_error("The note can be at most #{NOTE_LIMIT} characters.", :unprocessable_content, "INVALID_NOTE") if note.length > NOTE_LIMIT

      report = Report.find(params[:id])
      target = target_user(report)
      if decision != "dismiss"
        return render_error("This report is not about a person or their listing, so there is nobody to #{decision}.", :unprocessable_content, "NO_TARGET") unless target
        return render_error("You cannot #{decision} yourself.", :conflict, "SELF_TARGET") if target.id == current_user.id
        return render_error("Admins cannot be #{decision == 'warn' ? 'warned' : 'suspended'} from a report.", :conflict, "ADMIN_TARGET") if target.admin?
        return render_error("This account was deleted by its owner.", :conflict, "ACCOUNT_DELETED") if target.deleted?
      end

      revoked = nil
      Report.transaction do
        report.lock!
        unless report.status == "open"
          render_error("This report was already closed.", :conflict, "REPORT_CLOSED")
          raise ActiveRecord::Rollback
        end
        case decision
        when "warn"
          Notifier.moderation_warning(target, note.presence)
        when "suspend"
          target.update!(status: "suspended")
          revoked = target.sessions.delete_all
          audit!("admin.user.status", target, status: target.status, reportId: report.id)
        end
        report.update!(status: decision == "dismiss" ? "dismissed" : "resolved", action_taken: decision, resolution_note: note.presence,
          resolved_by_id: current_user.id, resolved_at: Time.current)
        audit!("admin.report.#{decision}", report, targetUserId: target&.id, sessionsRevoked: revoked, note: note.presence)
      end
      return if performed?

      render json: { ok: true, report: serialize_report(report) }
    end

    private

    # The account a report is about: the user itself, or the owner of the reported listing.
    def target_user(report)
      case report.entity_type.to_s.downcase
      when "user" then User.find_by(id: report.entity_id)
      when "job" then Job.find_by(id: report.entity_id)&.employer
      when "act" then Act.find_by(id: report.entity_id)&.owner
      end
    end

    # Only a conversation between the reporter and the reported user: the reporter controls the
    # details text, so an id pointing at someone else's conversation is ignored.
    def reported_conversation(report, target)
      return nil unless target && report.reporter_id && report.entity_type.to_s.downcase == "user"
      id = report.details.to_s[CONVERSATION_REFERENCE, 1]
      conversation = id && Conversation.find_by(id:)
      return nil unless conversation
      participants = [conversation.candidate_id, conversation.employer_id]
      participants.sort == [report.reporter_id, target.id].sort ? conversation : nil
    end

    def conversation_excerpt(conversation, report)
      return nil unless conversation
      before = conversation.messages.includes(:sender).where(created_at: ..report.created_at)
        .order(created_at: :desc, id: :desc).limit(EXCERPT_SIZE).to_a.reverse
      {
        id: conversation.id, jobTitle: conversation.job&.title,
        participants: [conversation.candidate, conversation.employer].map { { id: _1.id, name: _1.name } },
        messages: before.map { { id: _1.id, senderId: _1.sender_id, senderName: _1.sender.name, body: _1.body, createdAt: _1.created_at, safetyFlags: _1.safety_flags } },
        earlierMessages: [conversation.messages.where(created_at: ..report.created_at).count - before.length, 0].max,
        laterMessages: conversation.messages.where("created_at > ?", report.created_at).count
      }
    end

    def history_for(user, report)
      about = reports_about(user)
      {
        reportsTotal: about.count,
        reportsLast90Days: about.where(created_at: HISTORY_WINDOW.ago..).count,
        openReports: about.where(status: "open").where.not(id: report.id).count,
        warnings: about.where(action_taken: "warn").count,
        suspensions: about.where(action_taken: "suspend").count,
        flaggedMessagesLast90Days: Message.flagged.where(sender_id: user.id, created_at: HISTORY_WINDOW.ago..).count
      }
    end

    def reports_about(user)
      Report.where(entity_type: %w[user User], entity_id: user.id)
        .or(Report.where(entity_type: %w[job Job], entity_id: Job.where(employer_id: user.id).select(:id)))
        .or(Report.where(entity_type: %w[act Act], entity_id: Act.where(owner_id: user.id).select(:id)))
    end

    def serialize_report(report)
      { id: report.id, entityType: report.entity_type, entityId: report.entity_id, reason: report.reason, details: report.details,
        status: report.status, actionTaken: report.action_taken, resolutionNote: report.resolution_note, createdAt: report.created_at,
        resolvedAt: report.resolved_at, reporterId: report.reporter_id, reporterName: report.reporter&.name }
    end
  end
end
